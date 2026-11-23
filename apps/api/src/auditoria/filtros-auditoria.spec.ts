import { FiltrosInvalidosError, leerFiltros } from './filtros-auditoria.js';

describe('filtros de la consulta de auditoría', () => {
  it('sin parámetros usa la primera página de 20', () => {
    expect(leerFiltros({})).toEqual({ pagina: 1, tamano: 20 });
  });

  it('convierte los números y las fechas que llegan como texto', () => {
    const filtros = leerFiltros({
      usuarioId: '3',
      accion: 'ingreso',
      documentoId: '9',
      desde: '2026-11-01',
      hasta: '2026-11-30T23:59:59Z',
      pagina: '2',
      tamano: '50',
    });
    expect(filtros.usuarioId).toBe(3);
    expect(filtros.documentoId).toBe(9);
    expect(filtros.accion).toBe('ingreso');
    expect(filtros.desde).toEqual(new Date('2026-11-01'));
    expect(filtros.hasta).toEqual(new Date('2026-11-30T23:59:59Z'));
    expect(filtros.pagina).toBe(2);
    expect(filtros.tamano).toBe(50);
  });

  it.each([
    ['pagina cero', { pagina: '0' }],
    ['pagina negativa', { pagina: '-1' }],
    ['pagina decimal', { pagina: '1.5' }],
    ['tamano cero', { tamano: '0' }],
    ['tamano sobre el tope de 100', { tamano: '101' }],
    ['tamano no numérico', { tamano: 'muchos' }],
    ['usuarioId cero', { usuarioId: '0' }],
    ['accion inexistente', { accion: 'borrar_todo' }],
    ['fecha inválida', { desde: 'ayer' }],
    ['rango invertido', { desde: '2026-12-01', hasta: '2026-11-01' }],
  ])('rechaza %s', (_caso, consulta) => {
    expect(() => leerFiltros(consulta)).toThrow(FiltrosInvalidosError);
  });

  it('el error nombra el parámetro que falló', () => {
    try {
      leerFiltros({ tamano: '500' });
      expect.unreachable();
    } catch (error) {
      expect((error as FiltrosInvalidosError).problemas.join(' ')).toMatch(/tamano/);
    }
  });
});
