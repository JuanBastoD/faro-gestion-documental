import { createHash, randomInt } from 'node:crypto';
// El generador de las pruebas de la API (pdf-lib): PDF con capa de texto real, ficticios y deterministas.
import { conErroresDeOcr, palabrasFicticias, pdfConTexto } from '../../../api/test/pdfs.ts';

export interface PdfDePrueba {
  nombre: string;
  datos: Buffer;
  sha256: string;
}

export interface PdfsDeLaPrueba {
  semilla: number;
  /** El documento original. */
  original: PdfDePrueba;
  /** Cuatro reescaneos del original: mismo texto con 1 % de palabras mal reconocidas, otros bytes (otro SHA-256). */
  reescaneos: readonly [PdfDePrueba, PdfDePrueba, PdfDePrueba, PdfDePrueba];
}

/** La semilla de la corrida: la de `FARO_E2E_SEMILLA` si se define (para repetir una corrida) o una al azar. */
export function semillaDeLaCorrida(): number {
  const dada = process.env.FARO_E2E_SEMILLA;
  if (dada !== undefined && dada !== '') {
    const numero = Number(dada);
    if (!Number.isInteger(numero) || numero < 1) throw new Error('FARO_E2E_SEMILLA debe ser un entero positivo');
    return numero;
  }
  return randomInt(1, 1_000_000);
}

const sha256 = (datos: Buffer) => createHash('sha256').update(datos).digest('hex');

/**
 * Genera en memoria (no se escribe ningún PDF en disco ni en el repositorio) un documento y cuatro reescaneos suyos.
 * Cada corrida usa otra semilla, así que sus textos no se parecen a los de corridas anteriores que hayan quedado en la
 * base: el único parecido que ve la API es el que esta prueba provoca. Todo el texto es inventado.
 */
export async function generarPdfs(semilla: number): Promise<PdfsDeLaPrueba> {
  const palabras = palabrasFicticias(3000, semilla);
  const hacer = async (nombre: string, texto: string[], creado: string, productor: string): Promise<PdfDePrueba> => {
    const datos = await pdfConTexto(texto, { creado: new Date(creado), productor });
    return { nombre, datos, sha256: sha256(datos) };
  };

  const original = await hacer('original.pdf', palabras, '2026-03-02T10:00:00Z', 'Escáner A');
  const reescaneo = (letra: string, semillaDeErrores: number, dia: number) =>
    hacer(`reescaneo-${letra}.pdf`, conErroresDeOcr(palabras, 0.01, semillaDeErrores), `2026-05-${dia}T16:30:00Z`, `Escáner ${letra.toUpperCase()}`);

  return {
    semilla,
    original,
    reescaneos: [await reescaneo('a', 5, 15), await reescaneo('b', 6, 16), await reescaneo('c', 8, 18), await reescaneo('d', 9, 19)],
  };
}
