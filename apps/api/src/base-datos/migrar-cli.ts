import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { cargarEnvLocal } from '../config/cargar-env.js';
import { EntornoInvalidoError, validarEntorno } from '../config/entorno.js';
import * as esquema from './esquema.js';
import { migrar } from './migrar.js';

/**
 * Aplica las migraciones pendientes y termina. Es la forma de migrar donde no está `drizzle-kit`
 * (la imagen de producción solo trae dependencias de ejecución): `node dist/base-datos/migrar-cli.js`.
 * La API no migra al arrancar a propósito: con varias instancias o arranques en frío, migrar es un paso
 * aparte, antes de desplegar la versión nueva. Es seguro repetirlo.
 */
async function ejecutar(): Promise<void> {
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

  const pool = new pg.Pool({ connectionString: entorno.DATABASE_URL, max: 1 });
  try {
    await migrar(drizzle(pool, { schema: esquema }));
    console.log('Migraciones aplicadas.');
  } finally {
    await pool.end();
  }
}

await ejecutar();
