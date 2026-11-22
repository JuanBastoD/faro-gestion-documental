import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'drizzle-kit';

// Comandos npm -w apps/api: el directorio de trabajo es apps/api; el .env está en la raíz.
const envLocal = resolve(process.cwd(), '../../.env');
if (existsSync(envLocal)) {
  process.loadEnvFile(envLocal);
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/base-datos/esquema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
});
