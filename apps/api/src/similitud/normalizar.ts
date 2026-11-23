/**
 * Deja el texto extraído de un PDF en una forma comparable: minúsculas, sin tildes, sin signos
 * y con un solo espacio entre palabras. Así «Interventoría,» y «interventoria» son la misma palabra,
 * y las diferencias de maquetación (saltos de línea, guiones, espacios) no cuentan.
 */
export function normalizarTexto(texto: string): string {
  // NFKD y no NFD: además de separar las tildes, desarma las ligaduras que traen muchos PDF
  // («oﬁcio» → «oficio») y el indicador ordinal («N.º» → «N.o»).
  return texto
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Palabras de un texto ya normalizado. */
export function palabrasDe(textoNormalizado: string): string[] {
  return textoNormalizado === '' ? [] : textoNormalizado.split(' ');
}
