import { TAMANO_MAXIMO_BYTES } from '../api/documentos';
import { LIMITES_DE_USUARIO } from '../api/usuarios';
import { formatearTamano } from './formato';

/**
 * Validaciones del navegador para los formularios (carga, usuarios y filtros). Son una comodidad (avisar antes de subir 25 MB) y repiten
 * lo que fija la API; la API vuelve a validar todo, incluido el contenido real del PDF, y es la que decide. Cada función
 * devuelve el mensaje de error, o `undefined` si el valor sirve.
 */

const MAXIMO_EN_MB = TAMANO_MAXIMO_BYTES / (1024 * 1024);

/** Un archivo de la lista de selección. Se mira el tipo declarado y la extensión; el contenido lo revisa la API. */
export function validarArchivo(archivo: File | null | undefined): string | undefined {
  if (!archivo) return 'Elige el archivo PDF que quieres subir.';
  const esPdf = archivo.type === 'application/pdf' || /\.pdf$/i.test(archivo.name);
  if (!esPdf) return 'El archivo no es un PDF. Solo se aceptan archivos PDF (extensión .pdf).';
  if (archivo.size === 0) return 'El archivo está vacío. Elige otro.';
  if (archivo.size > TAMANO_MAXIMO_BYTES) {
    return `Pasa de ${MAXIMO_EN_MB} MB: este archivo pesa ${formatearTamano(archivo.size)}. Reduce su tamaño o divídelo.`;
  }
  return undefined;
}

/**
 * Un texto libre. Con `mensajeSiFalta` es obligatorio (un texto vacío o de espacios no cuenta); sin él es opcional.
 * El largo se cuenta sobre el texto sin espacios en los extremos, como lo hace la API.
 */
export function validarTexto(valor: string, maximo: number, mensajeSiFalta?: string): string | undefined {
  const texto = valor.trim();
  if (texto === '') return mensajeSiFalta;
  if (texto.length > maximo) return `Máximo ${maximo} caracteres: este tiene ${texto.length}.`;
  return undefined;
}

/** Primer año que acepta la interfaz: evita el `0202` que sale de un error al teclear el año en el selector de fecha. */
export const ANIO_MINIMO = 1900;

/** Una fecha de calendario `AAAA-MM-DD` que exista de verdad (no «2026-02-31»). */
export function validarFecha(valor: string): string | undefined {
  if (valor === '') return 'Indica la fecha que figura en el documento.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return 'Escribe la fecha como AAAA-MM-DD, por ejemplo 2026-03-15.';
  const fecha = new Date(`${valor}T00:00:00Z`);
  if (Number.isNaN(fecha.getTime()) || !fecha.toISOString().startsWith(valor)) {
    return 'Esa fecha no existe en el calendario. Revisa el día y el mes.';
  }
  if (fecha.getUTCFullYear() < ANIO_MINIMO) return `Revisa el año: la fecha no puede ser anterior a ${ANIO_MINIMO}.`;
  return undefined;
}

// --- Usuarios y filtros de auditoría (issue #25) ---------------------------------------------------------------------

/** Lo que admite la API como nombre de usuario: `^[a-z0-9][a-z0-9._-]{2,63}$` (`datos-usuario.ts`). */
const FORMA_DEL_USUARIO = /^[a-z0-9][a-z0-9._-]{2,63}$/;

/**
 * El nombre de usuario con el que la persona ingresará. La API lo recorta y solo admite minúsculas: no lo cambia en silencio
 * (ADR-008), así que aquí se dice qué está mal. El largo se cuenta sin espacios en los extremos.
 */
export function validarNombreDeUsuario(valor: string): string | undefined {
  const texto = valor.trim();
  const { usuarioMinimo, usuarioMaximo } = LIMITES_DE_USUARIO;
  if (texto === '') return 'Escribe el nombre de usuario con el que ingresará la persona.';
  if (texto.length < usuarioMinimo) return `Mínimo ${usuarioMinimo} caracteres: este tiene ${texto.length}.`;
  if (texto.length > usuarioMaximo) return `Máximo ${usuarioMaximo} caracteres: este tiene ${texto.length}.`;
  if (texto !== texto.toLowerCase()) {
    return `Escríbelo todo en minúsculas, por ejemplo «${texto.toLowerCase()}»: el sistema no cambia las mayúsculas por ti.`;
  }
  if (!FORMA_DEL_USUARIO.test(texto)) {
    return 'Usa solo letras minúsculas sin tilde, números, punto, guion y guion bajo, y empieza con una letra o un número.';
  }
  return undefined;
}

/**
 * La clave inicial que fija el administrador al crear la cuenta: de 12 a 256 caracteres y no solo espacios. A diferencia del
 * resto de los textos, NO se recorta: los espacios de los extremos cuentan como parte de la clave, igual que en la API.
 */
export function validarClaveInicial(valor: string): string | undefined {
  const { claveMinima, claveMaxima } = LIMITES_DE_USUARIO;
  if (valor === '') return 'Escribe la clave inicial.';
  if (valor.trim() === '') return 'La clave no puede ser solo espacios.';
  if (valor.length < claveMinima) return `Mínimo ${claveMinima} caracteres: esta tiene ${valor.length}.`;
  if (valor.length > claveMaxima) return `Máximo ${claveMaxima} caracteres: esta tiene ${valor.length}.`;
  return undefined;
}

/** El número de un documento en un filtro: opcional, y si se escribe debe ser un entero positivo. */
export function validarNumeroDeDocumento(valor: string): string | undefined {
  const texto = valor.trim();
  if (texto === '') return undefined;
  if (!/^\d{1,10}$/.test(texto) || Number(texto) < 1) return 'Escribe solo el número del documento, por ejemplo 12.';
  return undefined;
}

/** Una fecha opcional de un filtro: vacía está bien; si se escribe, debe existir en el calendario. */
export function validarFechaDeFiltro(valor: string): string | undefined {
  return valor === '' ? undefined : validarFecha(valor);
}

/** Que «desde» no sea posterior a «hasta» (las dos como `AAAA-MM-DD`; con una vacía no hay nada que comparar). */
export function validarOrdenDeFechas(desde: string, hasta: string): string | undefined {
  if (desde !== '' && hasta !== '' && desde > hasta) return 'La fecha «desde» no puede ser posterior a «hasta».';
  return undefined;
}
