import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// La API que atiende al servidor de desarrollo. Cambia con FARO_API_URL (por ejemplo, otro puerto).
const API = process.env.FARO_API_URL ?? 'http://127.0.0.1:3000';

// Rutas de la API (ADR-012). La interfaz vive bajo /app/, así que ninguna de las suyas choca con estas.
const RUTAS_DE_LA_API = ['/auth', '/series', '/documentos', '/usuarios', '/auditoria', '/health'];

export default defineConfig({
  // Todo se sirve bajo /app/: rutas del navegador como /documentos/12 chocarían con las de la API (ADR-012).
  base: '/app/',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: Object.fromEntries(
      RUTAS_DE_LA_API.map((ruta) => [
        ruta,
        {
          target: API,
          // false a propósito: la guarda de origen de la API compara `Origin` con `Host` (ADR-009). Con `true`,
          // el proxy cambiaría `Host` al de la API y `Origin` ya no coincidiría: 403 en cada POST.
          changeOrigin: false,
        },
      ]),
    ),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/pruebas/preparar.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});
