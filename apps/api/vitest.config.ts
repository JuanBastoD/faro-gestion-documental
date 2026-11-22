import { defineConfig } from 'vitest/config';

// Pruebas unitarias: no necesitan base de datos ni red.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts'],
  },
});
