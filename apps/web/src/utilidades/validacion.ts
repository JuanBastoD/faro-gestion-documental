import { TAMANO_MAXIMO_BYTES } from '../api/documentos';
import { formatearTamano } from './formato';

/**
 * Validaciones del navegador para los formularios de carga. Son una comodidad (avisar antes de subir 25 MB) y repiten
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
