import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Logger, type INestApplication } from '@nestjs/common';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Entorno } from '../config/entorno.js';

/**
 * La API sirve la interfaz web ya compilada (ADR-012): un solo contenedor y un solo origen, así que no hay CORS ni
 * cookies entre sitios. La interfaz vive bajo `/app/`; las rutas de la API (`/documentos`, `/auth`...) siguen donde
 * estaban, sin choques con las rutas del navegador.
 *
 * Es un middleware de Express registrado **fuera del enrutador de Nest** (`app.use`, no un controlador): así no
 * aparecen rutas nuevas en la API, no pasa por las guardas (la interfaz es solo HTML, JS y CSS públicos; los datos
 * siguen protegidos por la API) y la prueba de `docs/matriz-de-roles.md` no la ve.
 */
export const PREFIJO_DE_LA_INTERFAZ = '/app';

/**
 * Dónde está la interfaz compilada si no se configura otra cosa: `apps/web/dist`, contado desde este archivo. Vale
 * tanto en el repositorio (`apps/api/dist/interfaz/` → `apps/web/dist`) como en la imagen de Docker
 * (`/app/apps/api/dist/interfaz/` → `/app/apps/web/dist`).
 */
export const CARPETA_POR_DEFECTO = fileURLToPath(new URL('../../../web/dist', import.meta.url));

const UN_ANO_EN_MS = 365 * 24 * 60 * 60 * 1000;
const UNA_HORA_EN_MS = 60 * 60 * 1000;

/**
 * La carpeta de la interfaz compilada, o `undefined` si no hay una (la API arranca igual, sin interfaz). Una ruta
 * relativa de `INTERFAZ_RUTA` se cuenta desde el directorio donde se ejecuta la API. Cuenta como interfaz solo si
 * tiene un `index.html`.
 */
export function carpetaDeLaInterfaz(entorno: Pick<Entorno, 'INTERFAZ_RUTA'>): string | undefined {
  const carpeta = entorno.INTERFAZ_RUTA ? resolve(entorno.INTERFAZ_RUTA) : CARPETA_POR_DEFECTO;
  return existsSync(join(carpeta, 'index.html')) ? carpeta : undefined;
}

/** Lo que va después de `/app/` en una ruta, ya sin codificar; `undefined` si está mal codificada o es sospechosa. */
function rutaRelativa(rutaCompleta: string): string | undefined {
  let relativa: string;
  try {
    relativa = decodeURIComponent(rutaCompleta.slice(PREFIJO_DE_LA_INTERFAZ.length + 1));
  } catch {
    return undefined;
  }
  // `sendFile` con `root` ya rechaza los `..` y los bytes nulos; esto es una segunda barrera, barata.
  if (relativa.includes('\0') || relativa.includes('\\') || relativa.split('/').includes('..')) return undefined;
  return relativa;
}

/**
 * - `GET /` y `/app` redirigen a `/app/`. [CONFIRMADO] Antes de este cambio `GET /` respondía 404 (`Cannot GET /`)
 *   y ningún cliente lo usaba: redirigir no quita nada.
 * - `/app/assets/*`: los archivos de Vite llevan una huella en el nombre, así que nunca cambian de contenido:
 *   caché de un año e `immutable`. Si no existe, 404 (no se responde `index.html` con un 200 que ocultaría el error).
 * - Otros archivos con extensión (`favicon.svg`): caché de una hora. Si no existen, 404.
 * - Todo lo demás bajo `/app/` (sin extensión) es una ruta del cliente, como `/app/documentos/12`: responde
 *   `index.html` con `no-cache` (el navegador revalida con ETag), para que una versión nueva se vea al recargar.
 * - Solo `GET` y `HEAD`. Cualquier otra cosa sigue su camino.
 */
export function crearMiddlewareDeInterfaz(carpeta: string): RequestHandler {
  const enviarIndice = (respuesta: Response, siguiente: NextFunction) =>
    respuesta.sendFile('index.html', { root: carpeta, cacheControl: false, headers: { 'Cache-Control': 'no-cache' } }, (error) => {
      if (error && !respuesta.headersSent) siguiente();
    });

  return (peticion: Request, respuesta: Response, siguiente: NextFunction) => {
    if (peticion.method !== 'GET' && peticion.method !== 'HEAD') {
      siguiente();
      return;
    }
    const ruta = peticion.path;

    if (ruta === '/') {
      respuesta.redirect(302, `${PREFIJO_DE_LA_INTERFAZ}/`);
      return;
    }
    if (ruta === PREFIJO_DE_LA_INTERFAZ) {
      respuesta.redirect(302, `${PREFIJO_DE_LA_INTERFAZ}/${peticion.url.slice(ruta.length)}`);
      return;
    }
    if (!ruta.startsWith(`${PREFIJO_DE_LA_INTERFAZ}/`)) {
      siguiente();
      return;
    }

    const relativa = rutaRelativa(ruta);
    if (relativa === undefined) {
      siguiente();
      return;
    }

    const ultimoSegmento = relativa.slice(relativa.lastIndexOf('/') + 1);
    const esArchivo = ultimoSegmento.includes('.');
    if (relativa === '' || relativa === 'index.html' || !esArchivo) {
      // Una ruta del cliente; `/app/assets/` sin archivo también cae aquí y devuelve el índice, sin consecuencias.
      enviarIndice(respuesta, siguiente);
      return;
    }

    const largaDuracion = relativa.startsWith('assets/');
    respuesta.sendFile(
      relativa,
      {
        root: carpeta,
        dotfiles: 'ignore',
        maxAge: largaDuracion ? UN_ANO_EN_MS : UNA_HORA_EN_MS,
        immutable: largaDuracion,
      },
      (error) => {
        if (error && !respuesta.headersSent) siguiente();
      },
    );
  };
}

/**
 * Registra la interfaz en la aplicación, después de `configurarSeguridad` (así los archivos también llevan las
 * cabeceras de helmet) y antes de `listen`. Devuelve la carpeta servida, o `undefined` si no hay interfaz compilada.
 */
export function configurarInterfaz(
  app: INestApplication,
  entorno: Pick<Entorno, 'INTERFAZ_RUTA'>,
): string | undefined {
  const registro = new Logger('Interfaz');
  const carpeta = carpetaDeLaInterfaz(entorno);
  if (!carpeta) {
    registro.log(
      'No hay interfaz web compilada (falta index.html): la API arranca sin ella. Se genera con «npm run build -w apps/web»; la carpeta se cambia con INTERFAZ_RUTA.',
    );
    return undefined;
  }
  app.use(crearMiddlewareDeInterfaz(carpeta));
  registro.log(`Interfaz web servida desde ${carpeta} en ${PREFIJO_DE_LA_INTERFAZ}/`);
  return carpeta;
}
