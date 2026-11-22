import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { cargarEnvLocal } from '../src/config/cargar-env.js';
import * as esquema from '../src/base-datos/esquema.js';
import { migrar } from '../src/base-datos/migrar.js';
import { nombreDeBase, urlDePruebas } from './url-pruebas.js';

/**
 * Se ejecuta una vez antes de todas las pruebas de integración (globalSetup):
 * crea la base de pruebas si no existe y le aplica las migraciones.
 */
export default async function prepararBase(): Promise<void> {
  cargarEnvLocal();
  const url = urlDePruebas();
  const nombre = nombreDeBase(url);

  // Para crear una base hay que conectarse a otra: se usa "postgres", con las mismas credenciales.
  const administracion = new URL(url);
  administracion.pathname = '/postgres';
  const cliente = new pg.Client({ connectionString: administracion.toString() });
  await cliente.connect();
  try {
    const { rowCount } = await cliente.query('select 1 from pg_database where datname = $1', [
      nombre,
    ]);
    if (rowCount === 0) {
      // El nombre ya pasó la validación [a-z0-9_]+_test, así que es seguro entre comillas.
      await cliente.query(`create database "${nombre}"`);
    }
  } finally {
    await cliente.end();
  }

  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    await migrar(drizzle(pool, { schema: esquema }));
  } finally {
    await pool.end();
  }
}
