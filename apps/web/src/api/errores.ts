import { formatearEspera } from '../utilidades/formato';
import { mensajeDeError } from '../utilidades/mensajes';
import { ErrorApi } from './cliente';
import { TAMANO_MAXIMO_BYTES, type Candidato, type ConflictoDeDuplicado, type UbicacionDeVersion } from './documentos';

/**
 * Traducción de los errores de la API a mensajes para las pantallas de carga, versión nueva y restauración (issue #24).
 * Es el único lugar donde se decide qué texto ve la persona: ninguna pantalla muestra `error.message` tal cual, porque
 * Nest y multer responden en inglés («File too large») y los mensajes de validación citan nombres de campos y de
 * parámetros de la API (`decision=nueva_version`). Cada mensaje dice qué pasó y qué hacer.
 */

/** Los campos del formulario de la API a los que puede apuntar un error de validación. */
export type CampoDeFormulario =
  | 'archivo'
  | 'titulo'
  | 'expediente'
  | 'serieId'
  | 'fechaDocumento'
  | 'motivo'
  | 'decision'
  | 'documentoId'
  | 'justificacion';

/** Qué se estaba haciendo cuando falló: cambia el texto de algunos errores (un 404, un 409). */
export type Operacion = 'carga' | 'version' | 'restauracion';

export interface ErrorTraducido {
  /** Lo que se muestra en la alerta de la pantalla. */
  mensaje: string;
  /** Mensajes por campo, cuando la API señaló cuál estaba mal. */
  campos: Partial<Record<CampoDeFormulario, string>>;
}

const ETIQUETA: Record<CampoDeFormulario, string> = {
  archivo: 'El archivo',
  titulo: 'El título',
  expediente: 'El expediente',
  serieId: 'La subserie',
  fechaDocumento: 'La fecha del documento',
  motivo: 'El motivo',
  decision: 'La decisión',
  documentoId: 'El documento elegido',
  justificacion: 'La justificación',
};

const CAMPOS = Object.keys(ETIQUETA) as CampoDeFormulario[];

function esCampo(nombre: string): nombre is CampoDeFormulario {
  return (CAMPOS as string[]).includes(nombre);
}

const MENSAJE_GENERICO_400 = 'Algún dato del formulario no es válido. Revísalo e inténtalo de nuevo.';

/** Cuántos megabytes son el máximo, para el texto («20 MB»). */
const MAXIMO_EN_MB = TAMANO_MAXIMO_BYTES / (1024 * 1024);

/**
 * Convierte un problema de validación de la API (`"campo: texto"`) en una frase para la persona y el campo al que apunta.
 * Los textos que la API redacta para quien programa (`es obligatorio con decision=nueva_version: ...`) se reescriben; los
 * demás se anteponen con el nombre del campo («El título no puede pasar de 200 caracteres»).
 */
export function traducirProblema(problema: string): { campo: CampoDeFormulario | undefined; frase: string } {
  const separador = problema.indexOf(': ');
  const nombre = separador === -1 ? '' : problema.slice(0, separador);
  const detalle = separador === -1 ? problema : problema.slice(separador + 2);
  const campo = esCampo(nombre) ? nombre : undefined;
  if (!campo) return { campo: undefined, frase: MENSAJE_GENERICO_400 };

  if (/^es obligatori[oa] con decision=nueva_version/.test(detalle)) {
    return campo === 'documentoId'
      ? { campo, frase: 'Falta elegir el documento al que se agrega la versión.' }
      : { campo, frase: 'El motivo es obligatorio: explica qué cambió en esta versión.' };
  }
  if (/^es obligatori[oa] con decision=documento_distinto/.test(detalle)) {
    return { campo, frase: 'La justificación es obligatoria: explica por qué no es un duplicado.' };
  }
  if (detalle.startsWith('solo aplica con')) {
    return { campo, frase: `${ETIQUETA[campo]} no corresponde a la decisión elegida.` };
  }
  if (campo === 'decision') {
    return { campo, frase: 'La decisión no es válida: elige una de las opciones.' };
  }
  // Lo que cita parámetros de la API no se muestra: se prefiere un texto genérico a uno técnico.
  if (detalle.includes('=')) return { campo, frase: `${ETIQUETA[campo]} no es válido.` };
  return { campo, frase: `${ETIQUETA[campo]} ${detalle}${detalle.endsWith('.') ? '' : '.'}` };
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function esUbicacion(valor: unknown): valor is UbicacionDeVersion {
  return (
    esObjeto(valor) &&
    typeof valor.documentoId === 'number' &&
    typeof valor.version === 'number' &&
    typeof valor.titulo === 'string' &&
    typeof valor.expediente === 'string' &&
    typeof valor.serieCodigo === 'string'
  );
}

function esCandidato(valor: unknown): valor is Candidato {
  return esUbicacion(valor) && typeof (valor as unknown as Record<string, unknown>).similitud === 'number';
}

/**
 * Lee el cuerpo de un 409 de `POST /documentos` como aviso de duplicado. Devuelve `undefined` si no es uno (o si la
 * respuesta no trae la forma esperada): el llamador cae entonces en el mensaje de error común, sin romperse.
 */
export function leerConflictoDeDuplicado(error: unknown): ConflictoDeDuplicado | undefined {
  if (!(error instanceof ErrorApi) || error.estado !== 409 || !esObjeto(error.cuerpo)) return undefined;
  const cuerpo = error.cuerpo;
  const message = typeof cuerpo.message === 'string' ? cuerpo.message : '';
  if (cuerpo.codigo === 'duplicado_exacto' && esUbicacion(cuerpo.existente)) {
    return { codigo: 'duplicado_exacto', message, existente: cuerpo.existente };
  }
  if (
    cuerpo.codigo === 'duplicado_probable' &&
    typeof cuerpo.umbral === 'number' &&
    Array.isArray(cuerpo.candidatos) &&
    cuerpo.candidatos.length > 0 &&
    cuerpo.candidatos.every(esCandidato)
  ) {
    return { codigo: 'duplicado_probable', message, umbral: cuerpo.umbral, candidatos: cuerpo.candidatos };
  }
  return undefined;
}

function textoDeDuplicadoExacto(existente: UbicacionDeVersion): string {
  return (
    `Este archivo ya está en el sistema: documento «${existente.titulo}» (expediente ${existente.expediente}, ` +
    `subserie ${existente.serieCodigo}), versión ${existente.version}. El mismo archivo no se puede cargar dos veces: ` +
    'abre el documento que ya existe.'
  );
}

function numeroDe(cuerpo: unknown, clave: string): number | undefined {
  if (!esObjeto(cuerpo)) return undefined;
  const valor = cuerpo[clave];
  return typeof valor === 'number' ? valor : undefined;
}

function traducir409(error: ErrorApi, operacion: Operacion): string {
  if (operacion === 'restauracion') {
    const vigente = numeroDe(error.cuerpo, 'versionVigente');
    return vigente === undefined
      ? 'Esa versión ya tiene el mismo contenido que la vigente, así que no se creó ninguna versión nueva.'
      : `La versión vigente (${vigente}) ya tiene el mismo contenido que la versión que quieres restaurar, así que no se creó ninguna versión nueva.`;
  }
  const conflicto = leerConflictoDeDuplicado(error);
  if (conflicto?.codigo === 'duplicado_exacto') return textoDeDuplicadoExacto(conflicto.existente);
  if (conflicto?.codigo === 'duplicado_probable') {
    return 'Hay documentos con un texto muy parecido: decide qué hacer con este archivo antes de cargarlo.';
  }
  // Contenido que ya está en una versión del documento (versión nueva, o carga como versión de un documento existente).
  if (esObjeto(error.cuerpo) && 'versionExistente' in error.cuerpo) {
    const numero = numeroDe(error.cuerpo, 'versionExistente');
    return (
      (numero === undefined
        ? 'Este archivo ya está en una versión del documento'
        : `Este archivo tiene el mismo contenido que la versión ${numero} del documento`) +
      ', así que no se creó ninguna versión nueva. Si hiciste cambios, guarda el archivo corregido y súbelo de nuevo.'
    );
  }
  return 'La acción choca con el estado actual de los datos. Recarga la página e inténtalo de nuevo.';
}

function traducir404(operacion: Operacion): string {
  switch (operacion) {
    case 'carga':
      return 'La subserie o el documento elegido ya no existe. Recarga la página para ver el cuadro de clasificación actualizado.';
    case 'version':
      return 'El documento ya no existe, así que no se subió la versión. Vuelve al listado de documentos.';
    case 'restauracion':
      return 'La versión o el documento ya no existe. Recarga la página para ver el historial actual.';
  }
}

/** El texto y los campos señalados para un error de la API o de la red. */
export function traducirError(error: unknown, operacion: Operacion): ErrorTraducido {
  const sinCampos = (mensaje: string): ErrorTraducido => ({ mensaje, campos: {} });
  if (!(error instanceof ErrorApi)) return sinCampos('Ocurrió un error inesperado. Intenta de nuevo.');

  switch (error.estado) {
    case 0:
      return sinCampos(
        'No se pudo conectar con el servidor. Revisa tu conexión e intenta de nuevo. ' +
          (operacion === 'restauracion'
            ? 'Antes de repetirlo, mira el historial: puede que la versión sí se haya creado.'
            : 'Si el archivo llegó a subirse, el sistema te avisará de que ya existe y no se duplicará.'),
      );
    case 400: {
      const campos: ErrorTraducido['campos'] = {};
      const frases: string[] = [];
      for (const problema of error.problemas) {
        const { campo, frase } = traducirProblema(problema);
        if (campo && !campos[campo]) campos[campo] = frase;
        if (!frases.includes(frase)) frases.push(frase);
      }
      if (frases.length > 0) return { mensaje: frases.join(' '), campos };
      // Un 400 sin lista de problemas: falta el archivo, o el formulario llegó mal formado.
      if (/archivo/i.test(error.message) && /falta/i.test(error.message)) {
        const frase = 'Falta el archivo: elige el PDF que quieres subir.';
        return { mensaje: frase, campos: { archivo: frase } };
      }
      return sinCampos(MENSAJE_GENERICO_400);
    }
    case 401:
      return sinCampos('Tu sesión terminó. Ingresa de nuevo para continuar.');
    case 403:
      if (error.codigo === 'cambio_de_clave_requerido') {
        return sinCampos('Tu clave es temporal: antes de hacer cualquier otra cosa tienes que cambiarla.');
      }
      return sinCampos(
        error.codigo === 'origen_no_permitido'
          ? 'La petición se hizo desde un sitio que el servidor no reconoce. Abre Faro desde su dirección habitual e inténtalo de nuevo.'
          : 'Tu usuario no tiene permiso para esta acción. Solo los administradores y los editores pueden cargar documentos y versiones.',
      );
    case 404:
      return sinCampos(traducir404(operacion));
    case 409:
      return sinCampos(traducir409(error, operacion));
    case 413:
      return {
        mensaje: `El archivo pesa más de ${MAXIMO_EN_MB} MB, que es el máximo. Vuelve a exportarlo con menos calidad de imagen o divídelo en partes.`,
        campos: { archivo: `Pasa de ${MAXIMO_EN_MB} MB.` },
      };
    case 415:
      return {
        mensaje:
          'El archivo no es un PDF válido. Solo se aceptan archivos PDF: revisa que no sea otro tipo de archivo con la extensión cambiada, o vuelve a guardarlo como PDF.',
        campos: { archivo: 'No es un PDF válido.' },
      };
    case 422:
      return {
        mensaje: 'La serie elegida no admite documentos. Elige una subserie del cuadro de clasificación.',
        campos: { serieId: 'Elige una subserie.' },
      };
    case 429:
      return sinCampos(
        error.esperaSeg === undefined
          ? 'Hiciste demasiadas peticiones en poco tiempo. Espera unos minutos e intenta de nuevo.'
          : `Hiciste demasiadas peticiones en poco tiempo. Intenta de nuevo en ${formatearEspera(error.esperaSeg)}.`,
      );
    default:
      if (error.estado >= 500) return sinCampos(mensajeDeError(error));
      return sinCampos(`No se pudo completar la acción (código ${error.estado}). Intenta de nuevo o avisa al administrador.`);
  }
}
