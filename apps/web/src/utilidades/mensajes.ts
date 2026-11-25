import { ErrorApi } from '../api/cliente';
import { formatearEspera } from './formato';

/**
 * El texto que se le muestra a la persona ante un error. Para 400, 404, 409, 413, 415 y 422 sirve el mensaje de la
 * API (los de negocio están escritos en español). Para 429 se arma con `Retry-After`; para 5xx y sin red, un texto
 * propio, porque ahí el mensaje del servidor puede ser técnico.
 */
export function mensajeDeError(error: unknown): string {
  if (!(error instanceof ErrorApi)) return 'Ocurrió un error inesperado. Intenta de nuevo.';
  if (error.estado === 429) {
    return error.esperaSeg === undefined
      ? 'Demasiados intentos. Espera unos minutos e intenta de nuevo.'
      : `Demasiados intentos de ingreso. Intenta de nuevo en ${formatearEspera(error.esperaSeg)}.`;
  }
  if (error.estado === 0) return 'No se pudo conectar con el servidor. Revisa tu conexión e intenta de nuevo.';
  if (error.estado >= 500) return 'El servidor tuvo un problema. Intenta de nuevo en unos minutos.';
  return error.message;
}
