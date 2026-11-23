/**
 * Firma de similitud de un texto (MinHash sobre grupos de palabras).
 *
 * Por qué no `pg_trgm` (ver ADR-006): la similitud de trigramas compara *conjuntos* de trigramas
 * de letras, y dos textos largos del mismo idioma comparten casi todos, así que cualquier par de
 * documentos de varias páginas sale muy parecido. Aquí se comparan grupos de palabras consecutivas:
 * un reescaneo comparte casi todos, dos documentos distintos casi ninguno.
 *
 * La firma son `TAMANO_FIRMA` números de 32 bits (1 KB). La fracción de posiciones iguales entre dos
 * firmas estima la similitud de Jaccard de los conjuntos de grupos de palabras, con un error típico
 * de unos 0,03. Cambiar cualquier constante de este archivo invalida las firmas ya guardadas.
 */

/** Cuántos números tiene la firma. */
export const TAMANO_FIRMA = 256;
/** Palabras consecutivas por grupo. */
export const PALABRAS_POR_GRUPO = 3;
/**
 * Con menos palabras que esto la firma no dice nada (una carátula, un sello, un número de página):
 * el documento se trata como «sin texto» y solo se verifica por huella exacta.
 */
export const MINIMO_PALABRAS = 50;

/** Semillas fijas: mismas firmas en cada arranque y en cada máquina. */
const SEMILLAS = (() => {
  const semillas = new Uint32Array(TAMANO_FIRMA);
  let estado = 0x9e3779b9;
  for (let i = 0; i < TAMANO_FIRMA; i++) {
    // xorshift32
    estado ^= estado << 13;
    estado >>>= 0;
    estado ^= estado >>> 17;
    estado ^= estado << 5;
    estado >>>= 0;
    semillas[i] = estado;
  }
  return semillas;
})();

/** Acabado de MurmurHash3: mezcla bien los bits de un entero de 32 bits. */
function mezclar(valor: number): number {
  let h = valor >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** FNV-1a de 32 bits sobre el texto del grupo. */
function huellaDeGrupo(texto: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Calcula la firma de una lista de palabras ya normalizadas.
 * Devuelve `null` si hay menos de `MINIMO_PALABRAS`.
 */
export function calcularFirma(palabras: readonly string[]): Uint32Array | null {
  if (palabras.length < MINIMO_PALABRAS) return null;
  const minimos = new Uint32Array(TAMANO_FIRMA).fill(0xffffffff);
  const grupos = palabras.length - PALABRAS_POR_GRUPO + 1;
  for (let g = 0; g < grupos; g++) {
    const base = huellaDeGrupo(palabras.slice(g, g + PALABRAS_POR_GRUPO).join(' '));
    for (let i = 0; i < TAMANO_FIRMA; i++) {
      const valor = mezclar(base ^ SEMILLAS[i]);
      if (valor < minimos[i]) minimos[i] = valor;
    }
  }
  return minimos;
}

/** Similitud estimada entre dos firmas, de 0 a 1. */
export function similitudDeFirmas(a: Uint32Array, b: Uint32Array): number {
  if (a.length !== TAMANO_FIRMA || b.length !== TAMANO_FIRMA) {
    throw new Error('Firma con un tamaño inesperado');
  }
  let iguales = 0;
  for (let i = 0; i < TAMANO_FIRMA; i++) if (a[i] === b[i]) iguales++;
  return iguales / TAMANO_FIRMA;
}

/** Para guardarla en una columna `bytea` (siempre en el mismo orden de bytes). */
export function firmaABytes(firma: Uint32Array): Buffer {
  const bytes = Buffer.alloc(TAMANO_FIRMA * 4);
  for (let i = 0; i < TAMANO_FIRMA; i++) bytes.writeUInt32LE(firma[i], i * 4);
  return bytes;
}

export function firmaDesdeBytes(bytes: Uint8Array): Uint32Array {
  if (bytes.length !== TAMANO_FIRMA * 4) throw new Error('Firma guardada con un tamaño inesperado');
  const vista = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const firma = new Uint32Array(TAMANO_FIRMA);
  for (let i = 0; i < TAMANO_FIRMA; i++) firma[i] = vista.readUInt32LE(i * 4);
  return firma;
}
