import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

/**
 * Pruebas de navegador (issue #26, ADR-012 §9). Playwright con Chromium contra la API COMPILADA, que sirve la interfaz
 * en `/app/` (el mismo camino que usa producción), con PostgreSQL real y los usuarios de demostración ya sembrados.
 *
 * Antes de correrlas: `npm run build` (API y web), migrar y sembrar la base de `DATABASE_URL` y exportar `SEMILLA_CLAVE`
 * (la clave con que se sembraron `admin.demo` y `editor.demo`). Ver README, «Pruebas de navegador».
 */

const PUERTO = Number(process.env.FARO_E2E_PUERTO ?? 3000);
const URL_BASE = `http://127.0.0.1:${PUERTO}`;
// La API se arranca desde su carpeta, como `npm start -w apps/api`: una ruta relativa de `ALMACEN_RUTA` cuenta desde ahí.
const CARPETA_DE_LA_API = fileURLToPath(new URL('../api/', import.meta.url));

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  outputDir: './test-results',

  // Un solo hilo y sin reintentos: la prueba es un recorrido con estado (usa una base compartida) y un reintento
  // taparía un fallo intermitente en vez de enseñarlo. La memoria del equipo de desarrollo tampoco da para más.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 90_000,
  expect: { timeout: 10_000 },

  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],

  use: {
    baseURL: URL_BASE,
    browserName: 'chromium',
    viewport: { width: 1280, height: 800 },
    locale: 'es-CO',
    timezoneId: 'America/Bogota',
    // La traza y la captura las guarda la propia prueba (los contextos se crean a mano y se comparten entre pasos),
    // y solo si algún paso falla. Ver `e2e/ayudas/sesion.ts`.
    trace: 'off',
    screenshot: 'off',
    // Para usar un Chromium que ya está instalado en este equipo en lugar de descargar otro. En el CI no se define:
    // allí `npx playwright install chromium` deja el navegador que esta versión de Playwright espera.
    launchOptions: { executablePath: process.env.FARO_CHROMIUM_RUTA || undefined },
  },

  // Siempre arranca su propio servidor (nunca reutiliza uno que ya esté corriendo): así lo que se prueba es la
  // compilación de esta copia del repositorio. Si el puerto está ocupado, Playwright lo dice y no sigue.
  webServer: {
    command: 'node dist/main.js',
    cwd: CARPETA_DE_LA_API,
    url: `${URL_BASE}/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...(process.env as Record<string, string>), PORT: String(PUERTO), HOST: '127.0.0.1' },
  },
});
