import { formatearEspera } from '../utilidades/formato';
import { mensajeDeError } from '../utilidades/mensajes';
import { ErrorApi } from './cliente';
import { LIMITES_DE_USUARIO } from './usuarios';

/**
 * Traducción de los errores de la API a mensajes para las pantallas de usuarios y de auditoría (issue #25). Sigue el patrón de
 * `errores.ts` (que es de las pantallas de documentos): ninguna pantalla muestra el texto del servidor tal cual, cada mensaje
 * dice qué pasó y qué hacer, y el 400 de validación se reparte por campo. Aquí se decide qué ve la persona; las pantallas solo
 * lo muestran. Una clave nunca aparece en un mensaje: los textos se arman con el nombre de usuario, no con lo que se tecleó
 * en la clave.
 */

/** Qué se estaba haciendo cuando falló (cambia el texto de un 404 o un 409). */
export type OperacionDeUsuarios = 'listar' | 'alta' | 'cambio';

/** Los campos del formulario de alta a los que puede apuntar un error. */
export type CampoDeAlta = 'usuario' | 'nombre' | 'rol' | 'clave';

export interface ErrorDeUsuarios {
  /** Lo que se muestra en la alerta de la pantalla. */
  mensaje: string;
  /** Mensajes por campo, cuando la API señaló cuál estaba mal. */
  campos: Partial<Record<CampoDeAlta, string>>;
  /** El 403 de rol (no el de origen): la sesión que tiene la interfaz puede estar desactualizada y conviene volver a leerla. */
  rolDesactualizado: boolean;
}

const ETIQUETA: Record<CampoDeAlta, string> = {
  usuario: 'El nombre de usuario',
  nombre: 'El nombre',
  rol: 'El rol',
  clave: 'La clave',
};

const CAMPOS_DE_ALTA = Object.keys(ETIQUETA) as CampoDeAlta[];

function esCampoDeAlta(nombre: string): nombre is CampoDeAlta {
  return (CAMPOS_DE_ALTA as string[]).includes(nombre);
}

const MENSAJE_GENERICO_400 = 'Algún dato no es válido. Revísalo e inténtalo de nuevo.';

/**
 * Convierte un problema de validación de `POST /usuarios` (`"campo: texto"`) en una frase para la persona y el campo al que
 * apunta. Los textos de la API están en español pero hablan de «campos»; aquí se reescriben con las palabras de la pantalla.
 */
export function traducirProblemaDeAlta(problema: string): { campo: CampoDeAlta | undefined; frase: string } {
  const separador = problema.indexOf(': ');
  const nombre = separador === -1 ? '' : problema.slice(0, separador);
  const detalle = separador === -1 ? problema : problema.slice(separador + 2);
  if (!esCampoDeAlta(nombre)) return { campo: undefined, frase: MENSAJE_GENERICO_400 };
  const campo = nombre;
  const etiqueta = ETIQUETA[campo];

  if (/^es obligatori[oa]/.test(detalle)) return { campo, frase: `${etiqueta} es ${campo === 'clave' ? 'obligatoria' : 'obligatorio'}.` };
  if (campo === 'usuario') {
    return {
      campo,
      frase: `El nombre de usuario debe tener de ${LIMITES_DE_USUARIO.usuarioMinimo} a ${LIMITES_DE_USUARIO.usuarioMaximo} caracteres: minúsculas, números, punto, guion y guion bajo, y empezar con una letra o un número.`,
    };
  }
  if (campo === 'rol') return { campo, frase: 'Elige uno de los tres roles de la lista.' };
  const maximo = /^no puede pasar de (\d+)/.exec(detalle)?.[1];
  if (maximo) return { campo, frase: `${etiqueta} no puede pasar de ${maximo} caracteres.` };
  const minimo = /^debe tener al menos (\d+)/.exec(detalle)?.[1];
  if (minimo) return { campo, frase: `${etiqueta} debe tener al menos ${minimo} caracteres.` };
  if (/^no puede ser solo espacios/.test(detalle)) return { campo, frase: `${etiqueta} no puede ser solo espacios.` };
  return { campo, frase: `${etiqueta} no es válido.` };
}

const TEXTO_DE_ORIGEN =
  'La petición se hizo desde un sitio que el servidor no reconoce. Abre Faro desde su dirección habitual e inténtalo de nuevo.';

/** El texto del 409 `ultimo_administrador` (ADR-008, sección 2.2). */
const TEXTO_ULTIMO_ADMINISTRADOR =
  'No se puede desactivar ni cambiar el rol del último administrador activo: el sistema se quedaría sin quien lo administre. ' +
  'Antes crea o reactiva a otro administrador y vuelve a intentarlo.';

/** El texto de un fallo que no depende de la pantalla (sin red, sesión, límite, 5xx), o `undefined` si sí depende. */
function textoComun(error: ErrorApi, haciendo: string, repetir: string): string | undefined {
  switch (error.estado) {
    case 0:
      return `No se pudo conectar con el servidor. Revisa tu conexión e intenta de nuevo. ${repetir}`;
    case 401:
      return 'Tu sesión terminó. Ingresa de nuevo para continuar.';
    case 429:
      return error.esperaSeg === undefined
        ? 'Hiciste demasiadas peticiones en poco tiempo. Espera unos minutos e intenta de nuevo.'
        : `Hiciste demasiadas peticiones en poco tiempo. Intenta de nuevo en ${formatearEspera(error.esperaSeg)}.`;
    default:
      if (error.estado >= 500) return mensajeDeError(error);
      return error.estado === 403 || error.estado === 404 || error.estado === 409 || error.estado === 400
        ? undefined
        : `No se pudo ${haciendo} (código ${error.estado}). Intenta de nuevo o avisa a quien administra el sistema.`;
  }
}

/**
 * El texto y los campos señalados para un error de la API o de la red en la pantalla de usuarios. `contexto.usuario` es el
 * nombre de usuario que se intentaba crear o cambiar, para citarlo en el mensaje.
 */
export function traducirErrorDeUsuarios(
  error: unknown,
  operacion: OperacionDeUsuarios,
  contexto: { usuario?: string } = {},
): ErrorDeUsuarios {
  const sinCampos = (mensaje: string, rolDesactualizado = false): ErrorDeUsuarios => ({ mensaje, campos: {}, rolDesactualizado });
  if (!(error instanceof ErrorApi)) return sinCampos('Ocurrió un error inesperado. Intenta de nuevo.');

  const haciendo = operacion === 'listar' ? 'cargar la lista de usuarios' : operacion === 'alta' ? 'crear el usuario' : 'hacer el cambio';
  const repetir =
    operacion === 'alta'
      ? 'Antes de repetirlo, mira la lista: puede que el usuario sí se haya creado.'
      : operacion === 'cambio'
        ? 'Antes de repetirlo, actualiza la lista: puede que el cambio sí se haya hecho.'
        : '';
  const comun = textoComun(error, haciendo, repetir);
  if (comun !== undefined) return sinCampos(comun.trim());

  switch (error.estado) {
    case 400: {
      const campos: ErrorDeUsuarios['campos'] = {};
      const frases: string[] = [];
      for (const problema of error.problemas) {
        const { campo, frase } = traducirProblemaDeAlta(problema);
        if (operacion === 'alta' && campo && !campos[campo]) campos[campo] = frase;
        if (!frases.includes(frase)) frases.push(frase);
      }
      if (operacion !== 'alta') return sinCampos('El cambio no es válido. Actualiza la lista e inténtalo de nuevo.');
      return { mensaje: frases.length > 0 ? frases.join(' ') : MENSAJE_GENERICO_400, campos, rolDesactualizado: false };
    }
    case 403:
      if (error.codigo === 'origen_no_permitido') return sinCampos(TEXTO_DE_ORIGEN);
      return sinCampos(
        'Tu usuario no tiene permiso para administrar usuarios: solo los administradores pueden. Si tu rol cambió hace poco, ingresa de nuevo.',
        true,
      );
    case 404:
      return sinCampos(
        operacion === 'cambio'
          ? 'El usuario ya no existe. Actualiza la lista para ver el estado actual.'
          : 'No se encontró lo que buscas. Actualiza la página e inténtalo de nuevo.',
      );
    default: {
      // 409
      if (error.codigo === 'ultimo_administrador') return sinCampos(TEXTO_ULTIMO_ADMINISTRADOR);
      if (error.codigo === 'usuario_existente') {
        const frase = contexto.usuario
          ? `Ya existe un usuario llamado «${contexto.usuario}». Elige otro nombre de usuario.`
          : 'Ya existe un usuario con ese nombre. Elige otro nombre de usuario.';
        return { mensaje: frase, campos: { usuario: frase }, rolDesactualizado: false };
      }
      return sinCampos('La acción choca con el estado actual de los datos. Actualiza la lista e inténtalo de nuevo.');
    }
  }
}

/** Frase para cada parámetro de `GET /auditoria` que la API pueda rechazar. */
const FRASE_POR_FILTRO: Record<string, string> = {
  usuarioId: 'El usuario elegido no es válido.',
  accion: 'La acción elegida no es válida.',
  documentoId: 'El número de documento no es válido.',
  desde: 'La fecha «desde» no es válida.',
  hasta: 'La fecha «hasta» no es válida.',
  pagina: 'La página pedida no es válida.',
  tamano: 'La cantidad de eventos por página no es válida.',
};

/** El texto para un error de `GET /auditoria`. */
export function traducirErrorDeAuditoria(error: unknown): string {
  if (!(error instanceof ErrorApi)) return 'Ocurrió un error inesperado. Intenta de nuevo.';
  const comun = textoComun(error, 'consultar la auditoría', '');
  if (comun !== undefined) return comun.trim();
  switch (error.estado) {
    case 400: {
      const frases: string[] = [];
      for (const problema of error.problemas) {
        const nombre = problema.split(':')[0]?.trim() ?? '';
        // La API valida el orden de las fechas con un mensaje propio, atado al campo `desde`.
        const frase = /posterior a hasta/.test(problema)
          ? 'La fecha «desde» no puede ser posterior a «hasta».'
          : (FRASE_POR_FILTRO[nombre] ?? 'Algún filtro no es válido.');
        if (!frases.includes(frase)) frases.push(frase);
      }
      return `${frases.length > 0 ? frases.join(' ') : 'Algún filtro no es válido.'} Revisa los filtros o quítalos e inténtalo de nuevo.`;
    }
    case 403:
      return error.codigo === 'origen_no_permitido'
        ? TEXTO_DE_ORIGEN
        : 'Tu usuario no tiene permiso para consultar la auditoría: solo los administradores pueden. Si tu rol cambió hace poco, ingresa de nuevo.';
    case 404:
      return 'No se encontró lo que buscas. Actualiza la página e inténtalo de nuevo.';
    default:
      return 'La consulta choca con el estado actual de los datos. Inténtalo de nuevo.';
  }
}
