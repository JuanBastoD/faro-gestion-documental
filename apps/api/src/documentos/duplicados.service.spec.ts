import { calcularFirma, firmaABytes } from '../similitud/firma.js';
import type { TextoDeVersion } from '../similitud/texto-pdf.js';
import type { Entorno } from '../config/entorno.js';
import { DuplicadosService } from './duplicados.service.js';
import type { DocumentosRepository, UbicacionDeVersion } from './documentos.repository.js';

/** `cantidad` palabras ficticias distintas entre sí; `prefijo` separa un vocabulario de otro. */
const palabras = (cantidad: number, prefijo: string) =>
  Array.from({ length: cantidad }, (_, i) => `${prefijo}${i}`);

/** Cambia una de cada `cada` palabras: una copia con errores, como un reescaneo con OCR. */
const conCambios = (base: string[], cada: number) =>
  base.map((p, i) => (i % cada === 0 ? `${p}x` : p));

function textoDe(lista: string[]): Extract<TextoDeVersion, { estado: 'ok' }> {
  const firma = calcularFirma(lista);
  if (!firma) throw new Error('el texto de la prueba es demasiado corto');
  return { estado: 'ok', textoNormalizado: lista.join(' '), firma: firmaABytes(firma), palabras: lista.length };
}

const SIN_TEXTO: TextoDeVersion = { estado: 'sin_texto', textoNormalizado: null, firma: null, palabras: 0 };

const ubicacion = (documentoId: number, version = 1): UbicacionDeVersion => ({
  documentoId,
  version,
  titulo: `Documento ${documentoId}`,
  expediente: 'EXP-1',
  serieCodigo: '100.1',
});

function crear(opciones: {
  exacto?: UbicacionDeVersion;
  firmas?: Array<UbicacionDeVersion & { firma: Buffer }>;
  umbral?: number;
}) {
  const buscarPorHuella = vi.fn(() => Promise.resolve(opciones.exacto));
  const firmasParaComparar = vi.fn(() => Promise.resolve(opciones.firmas ?? []));
  const repositorio = { buscarPorHuella, firmasParaComparar } as unknown as DocumentosRepository;
  const entorno = { UMBRAL_SIMILITUD: opciones.umbral ?? 0.8 } as Entorno;
  return { servicio: new DuplicadosService(repositorio, entorno), buscarPorHuella, firmasParaComparar };
}

describe('DuplicadosService.verificar', () => {
  const original = palabras(400, 'contrato');

  it('un archivo idéntico se reconoce por su huella y no hace falta comparar texto', async () => {
    const existente = ubicacion(7);
    const { servicio, firmasParaComparar } = crear({ exacto: existente });
    const resultado = await servicio.verificar('a'.repeat(64), textoDe(original));
    expect(resultado).toEqual({ exacto: existente, probables: [] });
    expect(firmasParaComparar).not.toHaveBeenCalled();
  });

  it('busca la huella que recibe', async () => {
    const { servicio, buscarPorHuella } = crear({});
    await servicio.verificar('b'.repeat(64), textoDe(original));
    expect(buscarPorHuella).toHaveBeenCalledWith('b'.repeat(64));
  });

  it('sin texto solo se puede verificar por huella: no compara y no inventa candidatos', async () => {
    const { servicio, firmasParaComparar } = crear({
      firmas: [{ ...ubicacion(1), firma: textoDe(original).firma }],
    });
    expect(await servicio.verificar('c'.repeat(64), SIN_TEXTO)).toEqual({ exacto: undefined, probables: [] });
    expect(firmasParaComparar).not.toHaveBeenCalled();
  });

  it('un reescaneo (mismo texto con algún error) sale como candidato', async () => {
    const { servicio } = crear({ firmas: [{ ...ubicacion(1), firma: textoDe(original).firma }] });
    const { exacto, probables } = await servicio.verificar('d'.repeat(64), textoDe(conCambios(original, 100)));
    expect(exacto).toBeUndefined();
    expect(probables).toHaveLength(1);
    expect(probables[0]).toMatchObject({ documentoId: 1, version: 1, titulo: 'Documento 1', serieCodigo: '100.1' });
    expect(probables[0].similitud).toBeGreaterThanOrEqual(0.8);
    expect(probables[0].similitud).toBeLessThan(1);
  });

  it('un documento distinto del mismo estilo no es candidato', async () => {
    const { servicio } = crear({ firmas: [{ ...ubicacion(1), firma: textoDe(palabras(400, 'otro')).firma }] });
    expect((await servicio.verificar('e'.repeat(64), textoDe(original))).probables).toEqual([]);
  });

  it('no sale la firma de los otros en el resultado', async () => {
    const { servicio } = crear({ firmas: [{ ...ubicacion(1), firma: textoDe(original).firma }] });
    const { probables } = await servicio.verificar('f'.repeat(64), textoDe(conCambios(original, 100)));
    expect(probables[0]).not.toHaveProperty('firma');
  });

  it('un documento con varias versiones parecidas aparece una sola vez, con la más parecida', async () => {
    const lejana = conCambios(original, 20); // ~5 % de cambios
    const cercana = conCambios(original, 200); // ~0,5 % de cambios
    const { servicio } = crear({
      firmas: [
        { ...ubicacion(1, 1), firma: textoDe(lejana).firma },
        { ...ubicacion(1, 2), firma: textoDe(cercana).firma },
      ],
    });
    const { probables } = await servicio.verificar('1'.repeat(64), textoDe(original));
    expect(probables).toHaveLength(1);
    expect(probables[0].version).toBe(2);
  });

  it('ordena del más parecido al menos y entrega a lo sumo cinco', async () => {
    const firmas = [100, 60, 40, 30, 25, 20, 15].map((cada, i) => ({
      ...ubicacion(i + 1),
      firma: textoDe(conCambios(original, cada)).firma,
    }));
    const { servicio } = crear({ firmas, umbral: 0.5 });
    const { probables } = await servicio.verificar('2'.repeat(64), textoDe(original));
    expect(probables).toHaveLength(5);
    const similitudes = probables.map((c) => c.similitud);
    expect(similitudes).toEqual([...similitudes].sort((a, b) => b - a));
    // El menos cambiado (documento 1) va primero.
    expect(probables[0].documentoId).toBe(1);
  });

  it('el umbral viene del entorno: con uno más exigente el mismo candidato queda fuera', async () => {
    const firmas = [{ ...ubicacion(1), firma: textoDe(conCambios(original, 20)).firma }];
    const nuevo = textoDe(original);
    expect((await crear({ firmas, umbral: 0.7 }).servicio.verificar('3'.repeat(64), nuevo)).probables).toHaveLength(1);
    expect((await crear({ firmas, umbral: 0.99 }).servicio.verificar('3'.repeat(64), nuevo)).probables).toEqual([]);
    expect(crear({ umbral: 0.93 }).servicio.umbral).toBe(0.93);
  });

  it('muestra la similitud con dos decimales', async () => {
    const { servicio } = crear({ firmas: [{ ...ubicacion(1), firma: textoDe(conCambios(original, 30)).firma }], umbral: 0.5 });
    const [candidato] = (await servicio.verificar('4'.repeat(64), textoDe(original))).probables;
    expect(candidato.similitud).toBe(Math.round(candidato.similitud * 100) / 100);
  });
});
