import { defineConfig } from 'vitest/config';

// Pruebas de integración: levantan la API contra el PostgreSQL real
// (el de `npm run infra:up` en local, un servicio en CI).
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    setupFiles: ['./test/preparar-entorno.ts'],
    // Un solo archivo a la vez: comparten la misma base de datos.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
