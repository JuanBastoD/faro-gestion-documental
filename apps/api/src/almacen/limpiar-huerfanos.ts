import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as esquema from '../base-datos/esquema.js';
import { cargarEnvLocal } from '../config/cargar-env.js';
import { EntornoInvalidoError, validarEntorno } from '../config/entorno.js';
import { DocumentosRepository } from '../documentos/documentos.repository.js';
import { crearAlmacen } from './almacen.module.js';
import { calcularHuerfanos } from './huerfanos.js';

const UNA_HORA_MS = 60 * 60 * 1000;

/**
 * `npm run almacen:huerfanos -w apps/api` lista los objetos que ninguna versión usa.
 * Con `-- --borrar` borra los de más de una hora. Sin esa opción no cambia nada.
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

  const borrar = process.argv.includes('--borrar');
  const almacen = crearAlmacen(entorno);
  const pool = new pg.Pool({ connectionString: entorno.DATABASE_URL, max: 2 });
  try {
    const repositorio = new DocumentosRepository(drizzle(pool, { schema: esquema }));
    const referenciadas = await repositorio.clavesReferenciadas();
    const objetos = await almacen.listar('documentos/');
    const huerfanos = calcularHuerfanos(objetos, referenciadas, new Date(), UNA_HORA_MS);

    console.log(
      `Objetos en el almacén: ${objetos.length}. Referenciados por alguna versión: ${referenciadas.size}. Huérfanos de más de una hora: ${huerfanos.length}.`,
    );
    for (const huerfano of huerfanos) {
      console.log(`  ${huerfano.clave}  (${huerfano.modificadoEn.toISOString()})`);
      if (borrar) await almacen.borrar(huerfano.clave);
    }
    if (huerfanos.length > 0) {
      console.log(borrar ? 'Borrados.' : 'No se borró nada. Repite con "-- --borrar" para borrarlos.');
    }
  } finally {
    await pool.end();
  }
}

await ejecutar();
