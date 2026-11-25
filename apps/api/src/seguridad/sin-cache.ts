import type { NextFunction, Request, Response } from 'express';

/**
 * Dónde vive la interfaz web compilada (ADR-012). Es contenido público, con su propia política de caché
 * (`index.html` revalida; los archivos con huella en el nombre duran un año): ahí no se pone `no-store`.
 */
const PREFIJO_DE_LA_INTERFAZ = '/app';

/** `/app` (que redirige a `/app/`) y todo lo que cuelga de `/app/`; `/aplicacion` o `/apps` no cuentan. */
export function esRutaDeLaInterfaz(ruta: string): boolean {
  return ruta === PREFIJO_DE_LA_INTERFAZ || ruta.startsWith(`${PREFIJO_DE_LA_INTERFAZ}/`);
}

/**
 * Ninguna respuesta de la API se guarda en la caché del navegador ni de un intermediario: `Cache-Control: no-store`
 * en todo lo que no sea la interfaz (revisión C3, H-07). Los listados, el detalle de un documento, quién es la
 * persona con sesión y los PDF descargados son datos que no deben quedar en el historial de un computador
 * compartido ni servirse de nuevo con «Atrás» después de cerrar sesión.
 *
 * Va como middleware de Express, antes de las rutas, para que alcance también a lo que no pasa por un controlador:
 * un 401 de las guardas, un 404 de una ruta que no existe y las respuestas de error. Si una ruta fijara su propio
 * `Cache-Control`, el suyo prevalece (hoy ninguna lo hace).
 */
export function sinCacheEnLaApi(peticion: Request, respuesta: Response, siguiente: NextFunction): void {
  if (!esRutaDeLaInterfaz(peticion.path)) respuesta.setHeader('Cache-Control', 'no-store');
  siguiente();
}
