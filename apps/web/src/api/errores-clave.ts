import { formatearEspera } from '../utilidades/formato';
import { mensajeDeError } from '../utilidades/mensajes';
import { CODIGO_CAMBIO_DE_CLAVE_REQUERIDO, ErrorApi } from './cliente';

/**
 * Traducción de los errores de la API a mensajes para las pantallas de clave (issue #51): cambiar la propia clave
 * (`POST /auth/clave`) y restablecer la de otra persona (`POST /usuarios/:id/clave`). Mismo patrón que `errores.ts` y
 * `errores-administracion.ts`: ninguna pantalla muestra el texto del servidor tal cual, cada mensaje dice qué pasó y qué hacer, y
 * el 400 se reparte por campo. Una clave nunca aparece en un mensaje: los textos hablan de «la clave», no de lo que se escribió.
 *
 * Lo que distingue a estos errores: la clave actual incorrecta es un 400 `clave_actual_incorrecta` (nunca un 401, que significaría
 * «sesión vencida»), el 429 trae `Retry-After` y comparte el límite con el ingreso, y el 403 `cambio_de_clave_requerido` no es un
 * problema de permisos sino «primero cambia tu clave temporal».
 */

export type OperacionDeClave = 'cambiar' | 'restablecer';

/** Los campos a los que puede apuntar un error: los dos de «cambiar mi clave» y el de la clave temporal de «restablecer». */
export type CampoDeClave = 'claveActual' | 'claveNueva' | 'clave';

export interface ErrorDeClave {
  /** Lo que se muestra en la alerta de la pantalla (o junto al campo, si es de un campo). */
  mensaje: string;
  /** Mensajes por campo, cuando la API señaló cuál estaba mal. */
  campos: Partial<Record<CampoDeClave, string>>;
  /** El 403 de rol (restablecer): la sesión de la interfaz puede estar desactualizada y conviene volver a leerla. */
  rolDesactualizado: boolean;
}

const ETIQUETA: Record<CampoDeClave, string> = {
  claveActual: 'La clave actual',
  claveNueva: 'La clave nueva',
  clave: 'La clave temporal',
};

const CAMPOS = Object.keys(ETIQUETA) as CampoDeClave[];

function esCampo(nombre: string): nombre is CampoDeClave {
  return (CAMPOS as string[]).includes(nombre);
}

const MENSAJE_GENERICO_400 = 'Algún dato no es válido. Revísalo e inténtalo de nuevo.';

/** El texto de la clave actual equivocada: la usa la alerta y el campo. */
export const TEXTO_CLAVE_ACTUAL_INCORRECTA = 'La clave actual no es correcta. Revísala e inténtalo de nuevo.';

const TEXTO_DE_ORIGEN =
  'La petición se hizo desde un sitio que el servidor no reconoce. Abre Faro desde su dirección habitual e inténtalo de nuevo.';

/** Convierte un problema de validación (`"campo: texto"`) en una frase para la persona y el campo al que apunta. */
export function traducirProblemaDeClave(problema: string): { campo: CampoDeClave | undefined; frase: string } {
  const separador = problema.indexOf(': ');
  const nombre = separador === -1 ? '' : problema.slice(0, separador);
  const detalle = separador === -1 ? problema : problema.slice(separador + 2);
  if (!esCampo(nombre)) return { campo: undefined, frase: MENSAJE_GENERICO_400 };
  const campo = nombre;
  const etiqueta = ETIQUETA[campo];

  if (/^es obligatori[oa]/.test(detalle)) return { campo, frase: `${etiqueta} es obligatoria.` };
  const maximo = /^no puede pasar de (\d+)/.exec(detalle)?.[1];
  if (maximo) return { campo, frase: `${etiqueta} no puede pasar de ${maximo} caracteres.` };
  const minimo = /^debe tener al menos (\d+)/.exec(detalle)?.[1];
  if (minimo) return { campo, frase: `${etiqueta} debe tener al menos ${minimo} caracteres.` };
  if (/^no puede ser solo espacios/.test(detalle)) return { campo, frase: `${etiqueta} no puede ser solo espacios.` };
  if (campo === 'claveNueva' && /^debe ser distinta/.test(detalle)) return { campo, frase: 'La clave nueva debe ser distinta de la actual.' };
  return { campo, frase: `${etiqueta} no es válida.` };
}

/**
 * El texto y los campos señalados para un error de la API o de la red en una pantalla de clave. `contexto.nombre` es la persona
 * a la que se le restablece la clave, para citarla en el mensaje.
 */
export function traducirErrorDeClave(error: unknown, operacion: OperacionDeClave, contexto: { nombre?: string } = {}): ErrorDeClave {
  const sinCampos = (mensaje: string, rolDesactualizado = false): ErrorDeClave => ({ mensaje, campos: {}, rolDesactualizado });
  if (!(error instanceof ErrorApi)) return sinCampos('Ocurrió un error inesperado. Intenta de nuevo.');

  switch (error.estado) {
    case 0:
      return sinCampos(
        operacion === 'cambiar'
          ? 'No se pudo conectar con el servidor. Revisa tu conexión e intenta de nuevo. Si tu clave sí se alcanzó a cambiar, la anterior ya no sirve: prueba ingresar con la nueva.'
          : 'No se pudo conectar con el servidor. Revisa tu conexión e intenta de nuevo. Si la clave sí se alcanzó a restablecer, la persona ya no puede ingresar con la anterior; puedes repetirlo y vale la última que restablezcas.',
      );
    case 400: {
      if (error.codigo === 'clave_actual_incorrecta') {
        return { mensaje: TEXTO_CLAVE_ACTUAL_INCORRECTA, campos: { claveActual: TEXTO_CLAVE_ACTUAL_INCORRECTA }, rolDesactualizado: false };
      }
      const campos: ErrorDeClave['campos'] = {};
      const frases: string[] = [];
      for (const problema of error.problemas) {
        const { campo, frase } = traducirProblemaDeClave(problema);
        if (campo && !campos[campo]) campos[campo] = frase;
        if (!frases.includes(frase)) frases.push(frase);
      }
      return { mensaje: frases.length > 0 ? frases.join(' ') : MENSAJE_GENERICO_400, campos, rolDesactualizado: false };
    }
    case 401:
      return sinCampos('Tu sesión terminó. Ingresa de nuevo para continuar.');
    case 403:
      if (error.codigo === 'origen_no_permitido') return sinCampos(TEXTO_DE_ORIGEN);
      if (error.codigo === CODIGO_CAMBIO_DE_CLAVE_REQUERIDO) {
        return sinCampos('Tu clave es temporal: antes de hacer cualquier otra cosa tienes que cambiarla.');
      }
      return operacion === 'restablecer'
        ? sinCampos('Tu usuario no tiene permiso para restablecer claves: solo los administradores pueden. Si tu rol cambió hace poco, ingresa de nuevo.', true)
        : sinCampos('No tienes permiso para esta acción.');
    case 404:
      return sinCampos(
        operacion === 'restablecer'
          ? `${contexto.nombre ? contexto.nombre : 'El usuario'} ya no existe. Actualiza la lista para ver el estado actual.`
          : 'No se encontró lo que buscas. Actualiza la página e inténtalo de nuevo.',
      );
    case 409:
      if (error.codigo === 'conflicto_de_clave') {
        return sinCampos(
          'Otra petición cambió tu clave al mismo tiempo. Espera un momento e inténtalo de nuevo; si ya la cambiaste, ingresa con la clave nueva.',
        );
      }
      if (error.codigo === 'restablecer_clave_propia') {
        return sinCampos('La clave de tu propia cuenta no se restablece desde aquí: usa «Cambiar mi clave» para elegir una nueva.');
      }
      return sinCampos('La acción choca con el estado actual de los datos. Actualiza la página e inténtalo de nuevo.');
    case 429:
      if (operacion === 'cambiar') {
        return sinCampos(
          error.esperaSeg === undefined
            ? 'Demasiados intentos con la clave actual. Espera unos minutos antes de volver a intentarlo; mientras tanto tampoco podrás ingresar.'
            : `Demasiados intentos con la clave actual. Intenta de nuevo en ${formatearEspera(error.esperaSeg)}; mientras tanto tampoco podrás ingresar.`,
        );
      }
      return sinCampos(
        error.esperaSeg === undefined
          ? 'Hiciste demasiadas peticiones en poco tiempo. Espera unos minutos e intenta de nuevo.'
          : `Hiciste demasiadas peticiones en poco tiempo. Intenta de nuevo en ${formatearEspera(error.esperaSeg)}.`,
      );
    default:
      if (error.estado >= 500) return sinCampos(mensajeDeError(error));
      return sinCampos(`No se pudo ${operacion === 'cambiar' ? 'cambiar la clave' : 'restablecer la clave'} (código ${error.estado}). Intenta de nuevo o avisa a quien administra el sistema.`);
  }
}
