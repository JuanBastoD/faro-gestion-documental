import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { cargarEnvLocal } from '../config/cargar-env.js';
import { EntornoInvalidoError, validarEntorno } from '../config/entorno.js';
import * as esquema from '../base-datos/esquema.js';
import { migrar } from '../base-datos/migrar.js';
import { sembrarCcdDemo } from './ccd-demo.js';
import { USUARIOS_DEMO, sembrarUsuariosDemo } from './usuarios-demo.js';

/**
 * Siembra de desarrollo: `npm run db:seed -w apps/api`.
 * Aplica las migraciones pendientes y crea los usuarios de demostración.
 * La clave sale de SEMILLA_CLAVE (ver .env.example); no hay una clave fija en el código.
 */
async function sembrar(): Promise<void> {
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

  if (entorno.NODE_ENV === 'production') {
    console.error('La siembra de datos de demostración no se ejecuta con NODE_ENV=production.');
    process.exit(1);
  }
  const clave = process.env.SEMILLA_CLAVE ?? '';
  if (clave.length < 12) {
    console.error('Define SEMILLA_CLAVE en .env con al menos 12 caracteres (ver .env.example).');
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: entorno.DATABASE_URL, max: 2 });
  try {
    const db = drizzle(pool, { schema: esquema });
    await migrar(db);
    const creados = await sembrarUsuariosDemo(db, clave);
    console.log(
      `Usuarios de demostración: ${creados} creados, ${USUARIOS_DEMO.length - creados} ya existían.`,
    );
    console.log(`Usuarios: ${USUARIOS_DEMO.map((u) => `${u.usuario} (${u.rol})`).join(', ')}`);
    const filas = await sembrarCcdDemo(db);
    console.log(`Cuadro de clasificación de demostración: ${filas} series y subseries al día.`);
  } finally {
    await pool.end();
  }
}

await sembrar();
