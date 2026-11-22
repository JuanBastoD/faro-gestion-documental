/**
 * Genera un PDF mínimo pero válido, con una página y el texto dado (una línea por elemento).
 * Los textos son siempre ficticios. Cada contenido distinto produce un archivo distinto.
 */
export function generarPdf(lineas: string[]): Buffer {
  const texto = lineas
    .map((linea, i) => `BT /F1 12 Tf 50 ${740 - i * 18} Td (${escapar(linea)}) Tj ET`)
    .join('\n');
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(texto, 'latin1')} >>\nstream\n${texto}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const posiciones = objetos.map((objeto, indice) => {
    const posicion = Buffer.byteLength(pdf, 'latin1');
    pdf += `${indice + 1} 0 obj\n${objeto}\nendobj\n`;
    return posicion;
  });
  const inicioXref = Buffer.byteLength(pdf, 'latin1');
  const entradas = posiciones.map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n${entradas}`;
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

function escapar(linea: string): string {
  return linea.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** Un PDF de `megabytes` MB: la firma válida seguida de relleno. Solo sirve para probar el límite de tamaño. */
export function pdfDeTamano(megabytes: number): Buffer {
  const cuerpo = Buffer.alloc(megabytes * 1024 * 1024, 0x20);
  cuerpo.write('%PDF-1.4\n', 0, 'latin1');
  return cuerpo;
}
