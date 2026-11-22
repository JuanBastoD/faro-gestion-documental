import { UnprocessableEntityException } from '@nestjs/common';
import { SeriesService, armarArbol } from './series.service.js';
import type { FilaSerie, SeriesRepository } from './series.repository.js';

const filas: FilaSerie[] = [
  { id: 1, codigo: '100', nombre: 'Gestión contractual', padreId: null },
  { id: 2, codigo: '100.1', nombre: 'Contratos de obra', padreId: 1 },
  { id: 3, codigo: '100.2', nombre: 'Interventoría', padreId: 1 },
  { id: 4, codigo: '200', nombre: 'Gestión jurídica', padreId: null },
];

describe('armarArbol', () => {
  it('agrupa las subseries bajo su serie y conserva el orden', () => {
    expect(armarArbol(filas)).toEqual([
      {
        id: 1,
        codigo: '100',
        nombre: 'Gestión contractual',
        subseries: [
          { id: 2, codigo: '100.1', nombre: 'Contratos de obra' },
          { id: 3, codigo: '100.2', nombre: 'Interventoría' },
        ],
      },
      { id: 4, codigo: '200', nombre: 'Gestión jurídica', subseries: [] },
    ]);
  });

  it('una subserie sin su serie padre se descarta en vez de fallar', () => {
    expect(armarArbol([{ id: 9, codigo: '900.1', nombre: 'Huérfana', padreId: 99 }])).toEqual([]);
  });

  it('con un cuadro vacío devuelve una lista vacía', () => {
    expect(armarArbol([])).toEqual([]);
  });
});

describe('SeriesService.exigirSubserie', () => {
  const servicio = new SeriesService({ listar: async () => filas } as unknown as SeriesRepository);

  it('acepta una subserie', async () => {
    await expect(servicio.exigirSubserie(2)).resolves.toBeUndefined();
  });

  it('rechaza una serie con 422 y dice cuál es', async () => {
    const error = await servicio.exigirSubserie(1).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect((error as Error).message).toContain('100');
  });

  it('rechaza una serie que no existe con 422', async () => {
    await expect(servicio.exigirSubserie(999)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});
