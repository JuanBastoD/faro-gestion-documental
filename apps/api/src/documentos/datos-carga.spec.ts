import { DatosInvalidosError, MOTIVO_CARGA_INICIAL, leerDatosCarga } from './datos-carga.js';

const VALIDOS = {
  titulo: 'Acta de inicio',
  expediente: 'EXP-001',
  serieId: '3',
  fechaDocumento: '2026-03-02',
};

describe('leerDatosCarga', () => {
  it('acepta los datos mínimos y completa el motivo', () => {
    expect(leerDatosCarga(VALIDOS)).toEqual({
      titulo: 'Acta de inicio',
      expediente: 'EXP-001',
      serieId: 3,
      fechaDocumento: '2026-03-02',
      motivo: MOTIVO_CARGA_INICIAL,
    });
  });

  it('recorta espacios y respeta el motivo dado', () => {
    const datos = leerDatosCarga({ ...VALIDOS, titulo: '  Acta  ', motivo: '  Primera entrega ' });
    expect(datos.titulo).toBe('Acta');
    expect(datos.motivo).toBe('Primera entrega');
  });

  it('un motivo vacío o de espacios se reemplaza por el de carga inicial', () => {
    expect(leerDatosCarga({ ...VALIDOS, motivo: '   ' }).motivo).toBe(MOTIVO_CARGA_INICIAL);
  });

  it.each([
    ['sin título', { ...VALIDOS, titulo: undefined }, 'titulo'],
    ['título de espacios', { ...VALIDOS, titulo: '   ' }, 'titulo'],
    ['título demasiado largo', { ...VALIDOS, titulo: 'x'.repeat(201) }, 'titulo'],
    ['sin expediente', { ...VALIDOS, expediente: undefined }, 'expediente'],
    ['expediente demasiado largo', { ...VALIDOS, expediente: 'x'.repeat(61) }, 'expediente'],
    ['serie no numérica', { ...VALIDOS, serieId: 'abc' }, 'serieId'],
    ['serie decimal', { ...VALIDOS, serieId: '1.5' }, 'serieId'],
    ['serie cero', { ...VALIDOS, serieId: '0' }, 'serieId'],
    ['sin fecha', { ...VALIDOS, fechaDocumento: undefined }, 'fechaDocumento'],
    ['fecha con otro formato', { ...VALIDOS, fechaDocumento: '02/03/2026' }, 'fechaDocumento'],
    ['fecha imposible', { ...VALIDOS, fechaDocumento: '2026-02-31' }, 'fechaDocumento'],
    ['motivo demasiado largo', { ...VALIDOS, motivo: 'x'.repeat(301) }, 'motivo'],
  ])('rechaza %s y nombra el campo', (_caso, entrada, campo) => {
    try {
      leerDatosCarga(entrada);
      expect.unreachable('debía lanzar');
    } catch (error) {
      expect(error).toBeInstanceOf(DatosInvalidosError);
      expect((error as DatosInvalidosError).problemas.join(' ')).toContain(campo);
    }
  });

  it('un cuerpo ausente da todos los campos obligatorios como problemas', () => {
    try {
      leerDatosCarga(undefined);
      expect.unreachable('debía lanzar');
    } catch (error) {
      const problemas = (error as DatosInvalidosError).problemas.join(' ');
      for (const campo of ['titulo', 'expediente', 'serieId', 'fechaDocumento']) {
        expect(problemas).toContain(campo);
      }
    }
  });
});
