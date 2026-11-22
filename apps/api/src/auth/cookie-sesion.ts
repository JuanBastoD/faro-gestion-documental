import type { CookieOptions } from 'express';

export const COOKIE_SESION = 'faro_sesion';

/** Duración de la cookie en el navegador. La vigencia real la decide el servidor (sesiones.vence_en). */
const DURACION_COOKIE_MS = 7 * 24 * 60 * 60 * 1000;

export function opcionesCookie(produccion: boolean): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: produccion,
    path: '/',
    maxAge: DURACION_COOKIE_MS,
  };
}

/** Lee una cookie de la cabecera `Cookie` sin depender de una librería. */
export function leerCookie(cabecera: string | undefined, nombre: string): string | undefined {
  if (!cabecera) return undefined;
  for (const par of cabecera.split(';')) {
    const igual = par.indexOf('=');
    if (igual === -1) continue;
    if (par.slice(0, igual).trim() === nombre) {
      return par.slice(igual + 1).trim() || undefined;
    }
  }
  return undefined;
}
