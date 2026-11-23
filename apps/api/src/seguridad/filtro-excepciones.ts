import { Catch, HttpException, IntrinsicException, type ArgumentsHost } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';

/** Una línea de SQL larga no aporta más: se corta para que el registro siga siendo legible. */
const LARGO_MAXIMO_DEL_RESUMEN = 500;

export interface ResumenDeError {
  /** Nombre de la clase del error (`DrizzleQueryError`, `TypeError`...); `string` u `object` si lo lanzado no era un `Error`. */
  clase: string;
  /** Primera línea del mensaje, sin lo que sigue (en un fallo de Drizzle: la consulta, sin `params`). */
  resumen: string;
  /** `code` del error o de su causa, por ejemplo `40P01` (interbloqueo de PostgreSQL) o `ECONNREFUSED`. */
  codigos: string[];
}

function codigoDe(valor: unknown): string | undefined {
  if (typeof valor !== 'object' || valor === null) return undefined;
  const codigo = (valor as { code?: unknown }).code;
  return typeof codigo === 'string' ? codigo : undefined;
}

/**
 * Lo único de un error inesperado que se escribe en el registro del servidor: la clase, la primera línea del
 * mensaje y los códigos (`code`) del error y de su causa. Nunca el resto del mensaje ni la causa entera.
 *
 * Por qué: un fallo de consulta de Drizzle (`DrizzleQueryError`) trae en el mensaje `params: ...` con los valores
 * de la consulta, que en `usuarios` son hashes de clave (el nuevo y, al cambiarla, el verificado), y su causa de
 * `pg` puede repetir el valor (`invalid input syntax for type integer: "..."`). El registro va a Cloud Logging, que
 * lo leen más personas y por más tiempo que la base (revisión C3, H-02).
 */
export function resumirError(error: unknown): ResumenDeError {
  if (!(error instanceof Error)) {
    // Un valor arbitrario (texto, objeto) puede traer cualquier cosa: solo se registra de qué tipo era.
    return { clase: typeof error, resumen: '(lo lanzado no era un Error)', codigos: [] };
  }
  const primeraLinea = (error.message.split(/\r?\n/, 1)[0] ?? '').trim();
  const resumen =
    primeraLinea.length > LARGO_MAXIMO_DEL_RESUMEN
      ? `${primeraLinea.slice(0, LARGO_MAXIMO_DEL_RESUMEN)}…`
      : primeraLinea;
  const codigos = [codigoDe(error), codigoDe(error.cause)].filter(
    (codigo, posicion, todos): codigo is string => codigo !== undefined && todos.indexOf(codigo) === posicion,
  );
  return { clase: error.constructor?.name || error.name || 'Error', resumen, codigos };
}

/**
 * El error que sí se registra: lleva el resumen y los pasos de la pila del original (rutas de archivo y números
 * de línea, sin valores), para poder ubicar el fallo sin el mensaje completo. No es una `HttpException` ni un
 * error con forma HTTP, así que Nest responde con él lo mismo que respondería con el original.
 *
 * Nest escribe un `Error` con `util.inspect`, que antepone el nombre de la clase del objeto al mensaje y que
 * imprime además sus propiedades propias y su `cause` (con un `DrizzleQueryError` salían `query`, `params` y la
 * causa de `pg`). Por eso el sustituto es una clase con el mismo nombre que la original (así el registro sigue
 * diciendo `DrizzleQueryError: ...`) y sin ninguna propiedad ni causa.
 */
function errorSinParametros(original: unknown): Error {
  const { clase, resumen, codigos } = resumirError(original);
  const mensaje = `${resumen}${codigos.length > 0 ? ` (código ${codigos.join(', ')})` : ''}`;
  // Una clase anónima en una propiedad calculada recibe ese nombre: `{ [clase]: class extends Error {} }[clase].name === clase`.
  const ClaseConElMismoNombre = { [clase]: class extends Error {} }[clase] as typeof Error;
  const error = new ClaseConElMismoNombre(mensaje);
  error.name = clase;
  const pasos =
    original instanceof Error
      ? (original.stack ?? '')
          .split(/\r?\n/)
          .filter((linea) => /^\s+at /.test(linea))
      : [];
  error.stack = [`${clase}: ${mensaje}`, ...pasos].join('\n');
  return error;
}

/**
 * Filtro global de excepciones (revisión C3, H-02). Hace lo mismo que el filtro por defecto de Nest, que es la
 * clase de la que hereda: la misma respuesta (500 genérico, o el código de un error con forma HTTP) y el mismo
 * contexto de registro (`ExceptionsHandler`). Cambia una sola cosa: lo que se escribe en el registro cuando el
 * error es inesperado, que pasa a ser el de `resumirError` en lugar del error entero.
 *
 * - `HttpException`, `IntrinsicException` (Nest no la registra) y los errores con forma HTTP (4xx de middleware, cuyo
 *   mensaje ya viaja al cliente): se pasan tal cual al filtro de Nest. Nada cambia para ellos.
 * - Todo lo demás se pasa al filtro de Nest dentro de un error sustituto (`errorSinParametros`).
 */
@Catch()
export class FiltroDeExcepciones extends BaseExceptionFilter {
  override catch(excepcion: unknown, host: ArgumentsHost): void {
    if (
      excepcion instanceof HttpException ||
      excepcion instanceof IntrinsicException ||
      this.isHttpError(excepcion)
    ) {
      super.catch(excepcion, host);
      return;
    }
    super.catch(errorSinParametros(excepcion), host);
  }
}
