import {
  conErroresDeOcr,
  conOtrosDatos,
  generarPdf,
  palabrasFicticias,
  pdfConTexto,
  pdfSinTexto,
} from '../../test/pdfs.js';
import {
  MINIMO_PALABRAS,
  TAMANO_FIRMA,
  calcularFirma,
  firmaABytes,
  firmaDesdeBytes,
  similitudDeFirmas,
} from './firma.js';
import { normalizarTexto, palabrasDe } from './normalizar.js';
import { extraerTexto } from './texto-pdf.js';

describe('normalizarTexto', () => {
  it('pasa a minúsculas, quita tildes y signos y deja un solo espacio', () => {
    expect(normalizarTexto('  CLÁUSULA   Décima:\n«Interventoría», año 2026.  ')).toBe(
      'clausula decima interventoria ano 2026',
    );
  });

  it('conserva letras y números de cualquier alfabeto y descarta el resto', () => {
    expect(normalizarTexto('N.º 12-34/56 (Ñandú)')).toBe('n o 12 34 56 nandu');
    expect(normalizarTexto('---')).toBe('');
  });

  it('desarma las ligaduras de los PDF: «oﬁcio» y «oficio» son la misma palabra', () => {
    expect(normalizarTexto('Oﬁcio de ﬂexibilización')).toBe(normalizarTexto('Oficio de flexibilizacion'));
  });

  it('palabrasDe devuelve una lista vacía para un texto vacío', () => {
    expect(palabrasDe('')).toEqual([]);
    expect(palabrasDe('uno dos')).toEqual(['uno', 'dos']);
  });
});

describe('firma de similitud', () => {
  const original = palabrasFicticias(4000, 1);
  const firmaOriginal = calcularFirma(original);

  it('con menos de MINIMO_PALABRAS no hay firma', () => {
    expect(calcularFirma(palabrasFicticias(MINIMO_PALABRAS - 1, 2))).toBeNull();
    expect(calcularFirma(palabrasFicticias(MINIMO_PALABRAS, 2))).not.toBeNull();
  });

  it('es determinista: el mismo texto da siempre la misma firma', () => {
    expect(calcularFirma(original)).toEqual(firmaOriginal);
    expect(firmaOriginal).toHaveLength(TAMANO_FIRMA);
  });

  it('un texto idéntico da similitud 1 y uno sin relación casi 0', () => {
    if (!firmaOriginal) throw new Error('sin firma');
    expect(similitudDeFirmas(firmaOriginal, calcularFirma(original) as Uint32Array)).toBe(1);
    const otro = calcularFirma(palabrasFicticias(4000, 99)) as Uint32Array;
    expect(similitudDeFirmas(firmaOriginal, otro)).toBeLessThan(0.05);
  });

  // Calibración del ADR-006, con 4000 palabras (unas 9 páginas) en lugar de las 45 000 de la simulación.
  it.each([
    ['reescaneo con 1 % de errores de OCR', () => conErroresDeOcr(original, 0.01, 7), 0.9, 1],
    ['reescaneo con 2 % de errores de OCR', () => conErroresDeOcr(original, 0.02, 7), 0.8, 0.97],
    ['misma plantilla con 15 % de datos distintos', () => conOtrosDatos(original, 0.15, 7), 0.3, 0.6],
    ['misma plantilla con 30 % de datos distintos', () => conOtrosDatos(original, 0.3, 7), 0, 0.35],
  ])('%s', (_nombre, variante, minimo, maximo) => {
    const similitud = similitudDeFirmas(firmaOriginal as Uint32Array, calcularFirma(variante()) as Uint32Array);
    expect(similitud).toBeGreaterThanOrEqual(minimo);
    expect(similitud).toBeLessThanOrEqual(maximo);
  });

  it('la maquetación no cuenta: tildes, mayúsculas, signos y saltos de línea dan la misma firma', () => {
    const maquetado = original.map((p, i) => (i % 9 === 0 ? `${p.toUpperCase()},` : p)).join('\n');
    expect(calcularFirma(palabrasDe(normalizarTexto(maquetado)))).toEqual(firmaOriginal);
  });

  it('se guarda y se lee como bytes sin cambiar', () => {
    const bytes = firmaABytes(firmaOriginal as Uint32Array);
    expect(bytes).toHaveLength(TAMANO_FIRMA * 4);
    expect(firmaDesdeBytes(bytes)).toEqual(firmaOriginal);
    // Aunque el Buffer venga de un trozo más grande (como los que entrega el controlador de pg).
    const grande = Buffer.concat([Buffer.alloc(7), bytes, Buffer.alloc(5)]);
    expect(firmaDesdeBytes(grande.subarray(7, 7 + bytes.length))).toEqual(firmaOriginal);
  });

  it('rechaza firmas de otro tamaño', () => {
    expect(() => similitudDeFirmas(new Uint32Array(3), new Uint32Array(3))).toThrow(/tamaño/);
    expect(() => firmaDesdeBytes(Buffer.alloc(10))).toThrow(/tamaño/);
  });
});

describe('extraerTexto', () => {
  it('lee la capa de texto y calcula la firma', async () => {
    const palabras = palabrasFicticias(600, 3);
    const texto = await extraerTexto(await pdfConTexto(palabras));
    expect(texto.estado).toBe('ok');
    if (texto.estado !== 'ok') return;
    expect(texto.palabras).toBe(600);
    expect(texto.textoNormalizado).toBe(palabras.join(' '));
    expect(firmaDesdeBytes(texto.firma)).toEqual(calcularFirma(palabras));
  });

  it('conserva las tildes del PDF y las quita al normalizar', async () => {
    const frase = 'Interventoría: cláusula de garantía del año 2026 para la obra'.split(' ');
    const palabras = Array.from({ length: 12 }, () => frase).flat();
    const texto = await extraerTexto(await pdfConTexto(palabras));
    expect(texto.estado).toBe('ok');
    expect(texto.textoNormalizado).toContain('interventoria clausula de garantia del ano 2026');
  });

  it('el mismo texto con distintos metadatos da la misma firma aunque los bytes difieran', async () => {
    const palabras = palabrasFicticias(800, 4);
    const a = await pdfConTexto(palabras, { creado: new Date('2026-03-02T10:00:00Z'), productor: 'Escáner A' });
    const b = await pdfConTexto(palabras, { creado: new Date('2026-05-20T16:30:00Z'), productor: 'Escáner B' });
    expect(a.equals(b)).toBe(false);
    const [ta, tb] = await Promise.all([extraerTexto(a), extraerTexto(b)]);
    expect(ta.firma).toEqual(tb.firma);
  });

  it('un PDF sin capa de texto queda marcado sin_texto', async () => {
    expect(await extraerTexto(await pdfSinTexto())).toEqual({
      estado: 'sin_texto',
      textoNormalizado: null,
      firma: null,
      palabras: 0,
    });
  });

  it('con muy poco texto (una carátula, un sello) también queda sin_texto y dice cuántas palabras tenía', async () => {
    const texto = await extraerTexto(generarPdf(['Acta de inicio', 'Contrato DEMO-001']));
    expect(texto).toMatchObject({ estado: 'sin_texto', firma: null });
    expect(texto.palabras).toBeGreaterThan(0);
    expect(texto.palabras).toBeLessThan(MINIMO_PALABRAS);
  });

  it('un PDF dañado no lanza: queda sin_texto', async () => {
    const texto = await extraerTexto(Buffer.from('%PDF-1.4\nesto no es un PDF de verdad'));
    expect(texto.estado).toBe('sin_texto');
  });

  it('no modifica el búfer que recibe', async () => {
    const pdf = await pdfConTexto(palabrasFicticias(300, 5));
    const copia = Buffer.from(pdf);
    await extraerTexto(pdf);
    expect(pdf.equals(copia)).toBe(true);
  });
});
