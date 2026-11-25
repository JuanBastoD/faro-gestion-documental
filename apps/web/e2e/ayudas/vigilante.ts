import type { Page } from '@playwright/test';

/**
 * Vigila una página mientras la prueba la usa y apunta todo lo que no debería pasar: errores y avisos de la consola,
 * errores de la página, peticiones que fallan y respuestas con estado 400 o más que la prueba no provocó a propósito.
 * Es el «sin errores de consola ni respuestas ≥ 400 no provocadas» del issue #26. Una violación de la política de
 * contenido (CSP) aparece en la consola como error, así que también queda apuntada aquí.
 */

/** Respuestas de error que son parte normal de la interfaz y no cuentan: abrir sin sesión pregunta quién es y recibe 401. */
const SIEMPRE_ESPERADAS: readonly RegExp[] = [/^401 GET \/auth\/yo$/];

/**
 * Chromium escribe en la consola «Failed to load resource: the server responded with a status of 409» por cada respuesta de
 * error. Ese mensaje no se juzga aquí: la respuesta misma sí se juzga (método y ruta incluidos) en el manejador de `response`.
 */
const CARGA_CON_ESTADO = /^Failed to load resource: the server responded with a status of \d{3}/;

export interface Vigilante {
  /** Lo inesperado, con la etiqueta de la página. Debe quedar vacío al terminar cada paso. */
  readonly hallazgos: string[];
  /** Las respuestas de error que la prueba provocó a propósito y que sí ocurrieron (`409 POST /documentos`). */
  readonly provocadas: string[];
  /**
   * Ejecuta `accion` sabiendo que va a provocar estas respuestas de error. Si alguna no ocurre, falla: una respuesta
   * provocada que no llega es un comportamiento que cambió. Lo que no esté declarado sigue siendo un hallazgo.
   */
  permitiendo: <T>(patrones: readonly RegExp[], accion: () => Promise<T>) => Promise<T>;
}

export function vigilar(page: Page, etiqueta: string): Vigilante {
  const hallazgos: string[] = [];
  const provocadas: string[] = [];
  let declaradas: readonly RegExp[] = [];
  let vistas = new Set<RegExp>();

  page.on('console', (mensaje) => {
    if (mensaje.type() !== 'error' && mensaje.type() !== 'warning') return;
    const texto = mensaje.text();
    if (CARGA_CON_ESTADO.test(texto)) return;
    hallazgos.push(`[${etiqueta}] consola ${mensaje.type()}: ${texto}`);
  });

  page.on('pageerror', (error) => {
    hallazgos.push(`[${etiqueta}] error de página: ${error.message}`);
  });

  page.on('requestfailed', (peticion) => {
    // Una petición cancelada por la propia interfaz (al cambiar de pantalla) no es un fallo.
    if (peticion.failure()?.errorText === 'net::ERR_ABORTED') return;
    hallazgos.push(`[${etiqueta}] petición fallida ${peticion.method()} ${peticion.url()}: ${peticion.failure()?.errorText ?? ''}`);
  });

  page.on('response', (respuesta) => {
    if (respuesta.status() < 400) return;
    const linea = `${respuesta.status()} ${respuesta.request().method()} ${new URL(respuesta.url()).pathname}`;
    const coincidencias = declaradas.filter((patron) => patron.test(linea));
    for (const patron of coincidencias) vistas.add(patron);
    if (coincidencias.length > 0 || SIEMPRE_ESPERADAS.some((patron) => patron.test(linea))) {
      if (!provocadas.includes(linea)) provocadas.push(linea);
    } else {
      hallazgos.push(`[${etiqueta}] respuesta inesperada ${linea}`);
    }
  });

  async function permitiendo<T>(patrones: readonly RegExp[], accion: () => Promise<T>): Promise<T> {
    const anteriores = declaradas;
    const vistasAntes = vistas;
    declaradas = [...anteriores, ...patrones];
    vistas = new Set<RegExp>();
    try {
      const resultado = await accion();
      const faltan = patrones.filter((patron) => !vistas.has(patron));
      if (faltan.length > 0) {
        throw new Error(`[${etiqueta}] se esperaba esta respuesta y no llegó: ${faltan.map(String).join(', ')}`);
      }
      return resultado;
    } finally {
      declaradas = anteriores;
      vistas = vistasAntes;
    }
  }

  return { hallazgos, provocadas, permitiendo };
}
