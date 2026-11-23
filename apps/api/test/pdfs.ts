import { PDFDocument, StandardFonts } from 'pdf-lib';

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

// ---------------------------------------------------------------------------------------------
// PDF con capa de texto real (generados con pdf-lib) para probar la verificación de duplicados.
// Todo el texto es ficticio y determinista.
// ---------------------------------------------------------------------------------------------
function generadorDeAzar(semilla: number): () => number {
  let estado = semilla >>> 0;
  return () => ((estado = (Math.imul(estado, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

const SILABAS = ['ca', 'de', 'la', 'es', 'en', 'co', 'ra', 'ta', 'ci', 'on', 'ni', 'to', 'pro', 'con', 'tra', 'ble', 'ma', 'ri', 'so', 'lu', 'ad', 'in', 'ter', 'ven', 'cion', 'do', 'cu', 'men', 'ju', 'rid', 'ico', 'obra', 'plan', 'gas', 'pa', 'go', 'cla', 'su', 'mi', 'nis'];

/** Palabras inventadas con una distribución parecida a la de un texto real (unas pocas muy frecuentes). */
export function palabrasFicticias(cantidad: number, semilla: number): string[] {
  const azar = generadorDeAzar(semilla);
  const vocabulario = Array.from({ length: 3000 }, () => {
    let palabra = '';
    for (let i = 0, n = 1 + Math.floor(azar() * 4); i < n; i++) palabra += SILABAS[Math.floor(azar() * SILABAS.length)];
    return palabra;
  });
  return Array.from({ length: cantidad }, () => vocabulario[Math.floor(vocabulario.length * azar() ** 2.2)]);
}

/** Simula un reescaneo: el mismo texto con una proporción de palabras mal reconocidas por el OCR. */
export function conErroresDeOcr(palabras: string[], proporcion: number, semilla: number): string[] {
  const azar = generadorDeAzar(semilla);
  return palabras.map((palabra) => (azar() < proporcion ? `${palabra.slice(1)}x` : palabra));
}

/** Mismo formato, otros datos: reemplaza una proporción de palabras (una plantilla con otros nombres y cifras). */
export function conOtrosDatos(palabras: string[], proporcion: number, semilla: number): string[] {
  const azar = generadorDeAzar(semilla);
  const otras = palabrasFicticias(palabras.length, semilla + 1);
  return palabras.map((palabra, i) => (azar() < proporcion ? otras[i] : palabra));
}

export interface MetadatosPdf {
  /** Distinta fecha o productor = distintos bytes con el mismo texto, como un reescaneo. */
  creado?: Date;
  productor?: string;
  titulo?: string;
}

const PALABRAS_POR_LINEA = 12;
const LINEAS_POR_PAGINA = 50;

/** PDF de varias páginas con ese texto como capa de texto. */
export async function pdfConTexto(palabras: string[], metadatos: MetadatosPdf = {}): Promise<Buffer> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setCreationDate(metadatos.creado ?? new Date('2026-03-02T10:00:00Z'));
  doc.setModificationDate(metadatos.creado ?? new Date('2026-03-02T10:00:00Z'));
  doc.setProducer(metadatos.productor ?? 'Escáner ficticio 1.0');
  doc.setTitle(metadatos.titulo ?? 'Documento ficticio');
  const fuente = await doc.embedFont(StandardFonts.Helvetica);
  const porPagina = PALABRAS_POR_LINEA * LINEAS_POR_PAGINA;
  for (let inicio = 0; inicio < palabras.length; inicio += porPagina) {
    const pagina = doc.addPage([595, 842]);
    const delaPagina = palabras.slice(inicio, inicio + porPagina);
    for (let l = 0; l * PALABRAS_POR_LINEA < delaPagina.length; l++) {
      const linea = delaPagina.slice(l * PALABRAS_POR_LINEA, (l + 1) * PALABRAS_POR_LINEA).join(' ');
      pagina.drawText(linea, { x: 40, y: 800 - l * 15, size: 9, font: fuente });
    }
  }
  return Buffer.from(await doc.save());
}

/** PDF escaneado sin OCR: una página con un dibujo y ninguna capa de texto. */
export async function pdfSinTexto(metadatos: MetadatosPdf = {}): Promise<Buffer> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setCreationDate(metadatos.creado ?? new Date('2026-03-02T10:00:00Z'));
  doc.setProducer(metadatos.productor ?? 'Escáner ficticio 1.0');
  doc.addPage([200, 200]).drawRectangle({ x: 20, y: 20, width: 100, height: 100 });
  return Buffer.from(await doc.save());
}
