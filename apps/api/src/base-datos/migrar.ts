import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { BaseDatos } from './base-datos.module.js';

/** Carpeta con las migraciones SQL (apps/api/drizzle), tanto desde src/ como desde dist/. */
export const CARPETA_MIGRACIONES = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** Aplica las migraciones pendientes. Es seguro repetirla: las ya aplicadas se omiten. */
export async function migrar(db: BaseDatos): Promise<void> {
  await migrate(db, { migrationsFolder: CARPETA_MIGRACIONES });
}
