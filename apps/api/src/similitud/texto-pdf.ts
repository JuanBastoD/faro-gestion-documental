import { Logger } from '@nestjs/common';
import { extractText } from 'unpdf';
import { calcularFirma, firmaABytes, MINIMO_PALABRAS } from './firma.js';
import { normalizarTexto, palabrasDe } from './normalizar.js';

export type EstadoTexto = 'ok' | 'sin_texto';

/** Lo que se guarda de cada versión para verificar duplicados y, más adelante, buscar por contenido. */
export type TextoDeVersion =
  | { estado: 'ok'; textoNormalizado: string; firma: Buffer; palabras: number }
  | { estado: 'sin_texto'; textoNormalizado: null; firma: null; palabras: number };

const logger = new Logger('TextoPdf');

/** Un PDF escaneado sin OCR no trae texto; uno dañado tampoco se puede leer. Ninguno bloquea la carga. */
const SIN_TEXTO: TextoDeVersion = { estado: 'sin_texto', textoNormalizado: null, firma: null, palabras: 0 };

/**
 * Extrae la capa de texto del PDF (no se corre OCR) y calcula su firma de similitud.
 * Nunca lanza: si no hay texto suficiente o el PDF no se puede leer, devuelve `sin_texto` y el
 * documento se verifica solo por huella exacta.
 */
export async function extraerTexto(datos: Buffer): Promise<TextoDeVersion> {
  let crudo: string;
  try {
    // pdf.js puede quedarse con el búfer y transferirlo: se le da una copia.
    const resultado = await extractText(new Uint8Array(datos), { mergePages: true });
    crudo = resultado.text;
  } catch (error) {
    logger.warn(
      `No se pudo leer la capa de texto del PDF; se verificará solo por huella: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return SIN_TEXTO;
  }

  const textoNormalizado = normalizarTexto(crudo);
  const palabras = palabrasDe(textoNormalizado);
  if (palabras.length < MINIMO_PALABRAS) return { ...SIN_TEXTO, palabras: palabras.length };

  const firma = calcularFirma(palabras);
  if (!firma) return { ...SIN_TEXTO, palabras: palabras.length };
  return { estado: 'ok', textoNormalizado, firma: firmaABytes(firma), palabras: palabras.length };
}
