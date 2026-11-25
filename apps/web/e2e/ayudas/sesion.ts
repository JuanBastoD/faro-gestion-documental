import type { Browser, BrowserContext, Page, TestInfo } from '@playwright/test';
import { vigilar, type Vigilante } from './vigilante.ts';

/**
 * Una persona en un navegador: su contexto (cookies propias), su página y su vigilante. Los pasos de la prueba son una
 * serie con estado (el ingreso del paso 2 sirve a los siguientes), así que los contextos se crean una vez, a mano, y se
 * comparten; por eso la traza y la captura de un fallo las guardan estas funciones y no la configuración global.
 */
export interface Sesion {
  etiqueta: string;
  contexto: BrowserContext;
  page: Page;
  vigilante: Vigilante;
  trazaActiva: boolean;
}

export async function abrirSesion(browser: Browser, testInfo: TestInfo, etiqueta: string): Promise<Sesion> {
  // En un `beforeAll` las opciones de `use` no se aplican solas a un contexto creado a mano: se pasan las del proyecto.
  const { baseURL, viewport, locale, timezoneId } = testInfo.project.use;
  const contexto = await browser.newContext({ baseURL, viewport, locale, timezoneId });
  await contexto.tracing.start({ screenshots: true, snapshots: true });
  const page = await contexto.newPage();
  return { etiqueta, contexto, page, vigilante: vigilar(page, etiqueta), trazaActiva: true };
}

/** Si un paso falló: guarda la captura de pantalla y la traza de cada sesión como adjuntos de ese paso. */
export async function guardarEvidenciaDelFallo(sesiones: readonly Sesion[], testInfo: TestInfo): Promise<void> {
  for (const sesion of sesiones) {
    if (!sesion.page.isClosed()) {
      await testInfo.attach(`captura-${sesion.etiqueta}`, {
        body: await sesion.page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      });
    }
    if (sesion.trazaActiva) {
      const ruta = testInfo.outputPath(`traza-${sesion.etiqueta}.zip`);
      await sesion.contexto.tracing.stop({ path: ruta });
      sesion.trazaActiva = false;
      await testInfo.attach(`traza-${sesion.etiqueta}`, { path: ruta, contentType: 'application/zip' });
    }
  }
}

/** Cierra las sesiones. Si todo salió bien la traza se descarta: no se guarda nada que no haga falta. */
export async function cerrarSesiones(sesiones: readonly Sesion[]): Promise<void> {
  for (const sesion of sesiones) {
    if (sesion.trazaActiva) {
      await sesion.contexto.tracing.stop();
      sesion.trazaActiva = false;
    }
    await sesion.contexto.close();
  }
}
