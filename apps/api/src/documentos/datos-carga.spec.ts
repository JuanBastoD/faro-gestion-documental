import {
  DatosInvalidosError,
  MOTIVO_CARGA_INICIAL,
  leerDatosCarga,
  motivoDe,
} from './datos-carga.js';

const VALIDOS = {
  titulo: 'Acta de inicio',
  expediente: 'EXP-001',
  serieId: '3',
  fechaDocumento: '2026-03-02',
};

describe('leerDatosCarga', () => {
  it('acepta los datos mínimos; sin motivo se usa el de carga inicial', () => {
    const datos = leerDatosCarga(VALIDOS);
    expect(datos).toEqual({
      titulo: 'Acta de inicio',
      expediente: 'EXP-001',
      serieId: 3,
      fechaDocumento: '2026-03-02',
    });
    expect(motivoDe(datos)).toBe(MOTIVO_CARGA_INICIAL);
  });

  it('recorta espacios y respeta el motivo dado', () => {
    const datos = leerDatosCarga({ ...VALIDOS, titulo: '  Acta  ', motivo: '  Primera entrega ' });
    expect(datos.titulo).toBe('Acta');
    expect(datos.motivo).toBe('Primera entrega');
  });

  it('un motivo vacío o de espacios se reemplaza por el de carga inicial', () => {
    const datos = leerDatosCarga({ ...VALIDOS, motivo: '   ' });
    expect(datos.motivo).toBeUndefined();
    expect(motivoDe(datos)).toBe(MOTIVO_CARGA_INICIAL);
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

  describe('decisión ante un duplicado probable', () => {
    it('nueva_version exige documentoId y motivo', () => {
      const datos = leerDatosCarga({ ...VALIDOS, decision: 'nueva_version', documentoId: '12', motivo: 'Mejor escaneo' });
      expect(datos).toMatchObject({ decision: 'nueva_version', documentoId: 12, motivo: 'Mejor escaneo' });
      expect(() => leerDatosCarga({ ...VALIDOS, decision: 'nueva_version', motivo: 'x' })).toThrow(/documentoId/);
      expect(() => leerDatosCarga({ ...VALIDOS, decision: 'nueva_version', documentoId: '12' })).toThrow(/motivo/);
    });

    it('documento_distinto exige justificación', () => {
      const datos = leerDatosCarga({ ...VALIDOS, decision: 'documento_distinto', justificacion: ' Otro contrato, misma plantilla ' });
      expect(datos).toMatchObject({ decision: 'documento_distinto', justificacion: 'Otro contrato, misma plantilla' });
      expect(() => leerDatosCarga({ ...VALIDOS, decision: 'documento_distinto' })).toThrow(/justificacion/);
      expect(() => leerDatosCarga({ ...VALIDOS, decision: 'documento_distinto', justificacion: '   ' })).toThrow(/justificacion/);
    });

    it('rechaza campos que no corresponden a la decisión', () => {
      expect(() => leerDatosCarga({ ...VALIDOS, decision: 'documento_distinto', justificacion: 'x', documentoId: '3' })).toThrow(/documentoId/);
      expect(() => leerDatosCarga({ ...VALIDOS, decision: 'nueva_version', documentoId: '3', motivo: 'x', justificacion: 'y' })).toThrow(/justificacion/);
      expect(() => leerDatosCarga({ ...VALIDOS, documentoId: '3' })).toThrow(/documentoId/);
      expect(() => leerDatosCarga({ ...VALIDOS, justificacion: 'y' })).toThrow(/justificacion/);
    });

    it('rechaza una decisión desconocida y una justificación demasiado larga', () => {
      expect(() => leerDatosCarga({ ...VALIDOS, decision: 'ignorar' })).toThrow(/decision/);
      expect(() => leerDatosCarga({ ...VALIDOS, decision: 'documento_distinto', justificacion: 'x'.repeat(501) })).toThrow(/justificacion/);
    });

    it('todos los problemas se informan juntos', () => {
      try {
        leerDatosCarga({ ...VALIDOS, decision: 'nueva_version' });
        throw new Error('debió fallar');
      } catch (error) {
        expect(error).toBeInstanceOf(DatosInvalidosError);
        expect((error as DatosInvalidosError).problemas).toHaveLength(2);
      }
    });
  });
});
