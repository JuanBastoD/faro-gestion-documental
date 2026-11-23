import { BadRequestException } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { cargarEnvLocal } from '../config/cargar-env.js';
import { EntornoInvalidoError, validarEntorno } from '../config/entorno.js';
import * as esquema from '../base-datos/esquema.js';
import { crearAdministradorInicial } from './administrador-inicial.js';

/**
 * Crea el primer administrador de una instalación nueva. Sirve también en producción (a diferencia de
 * `db:seed`, que no crea datos de demostración allí). Las migraciones deben estar aplicadas.
 *
 *   ADMIN_USUARIO  nombre de ingreso (minúsculas, 3 a 64 caracteres)
 *   ADMIN_CLAVE    clave de 12 a 256 caracteres
 *   ADMIN_NOMBRE   nombre para mostrar (opcional; por defecto «Administrador»)
 *
 * Las variables se leen del entorno y no de argumentos para que la clave no quede en el historial del
 * intérprete ni en la lista de procesos. En la nube, ADMIN_CLAVE viene de Secret Manager.
 */
async function crear(): Promise<void> {
  cargarEnvLocal();

  let entorno;
  try {
    entorno = validarEntorno(process.env);
  } catch (error) {
    if (error instanceof EntornoInvalidoError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  const pool = new pg.Pool({ connectionString: entorno.DATABASE_URL, max: 2 });
  try {
    const db = drizzle(pool, { schema: esquema });
    const creado = await crearAdministradorInicial(db, {
      usuario: process.env.ADMIN_USUARIO ?? '',
      nombre: process.env.ADMIN_NOMBRE ?? 'Administrador',
      clave: process.env.ADMIN_CLAVE ?? '',
    });
    console.log(
      creado
        ? `Administrador ${process.env.ADMIN_USUARIO} creado.`
        : `El usuario ${process.env.ADMIN_USUARIO} ya existe: no se cambió nada.`,
    );
  } catch (error) {
    if (error instanceof BadRequestException) {
      const respuesta = error.getResponse() as { problemas?: string[] };
      console.error('Datos inválidos (revisa ADMIN_USUARIO, ADMIN_NOMBRE y ADMIN_CLAVE):');
      for (const problema of respuesta.problemas ?? [error.message]) console.error(`  - ${problema}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  } finally {
    await pool.end();
  }
}

await crear();
