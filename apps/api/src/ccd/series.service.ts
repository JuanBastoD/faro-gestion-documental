import { Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { SeriesRepository, type FilaSerie } from './series.repository.js';

export interface Subserie {
  id: number;
  codigo: string;
  nombre: string;
}

export interface Serie extends Subserie {
  subseries: Subserie[];
}

/** Arma el árbol de dos niveles a partir de la lista plana. Una subserie sin serie padre se descarta. */
export function armarArbol(filas: FilaSerie[]): Serie[] {
  const series = new Map<number, Serie>();
  for (const fila of filas) {
    if (fila.padreId === null) {
      series.set(fila.id, { id: fila.id, codigo: fila.codigo, nombre: fila.nombre, subseries: [] });
    }
  }
  for (const fila of filas) {
    if (fila.padreId !== null) {
      series.get(fila.padreId)?.subseries.push({
        id: fila.id,
        codigo: fila.codigo,
        nombre: fila.nombre,
      });
    }
  }
  return [...series.values()];
}

@Injectable()
export class SeriesService {
  constructor(@Inject(SeriesRepository) private readonly repositorio: SeriesRepository) {}

  async arbol(): Promise<Serie[]> {
    return armarArbol(await this.repositorio.listar());
  }

  /**
   * Para los servicios que guardan documentos (#10): la serie debe existir y ser una subserie.
   * La base lo impone igual con un disparador; esto da un error claro antes de llegar a ella.
   */
  async exigirSubserie(serieId: number): Promise<void> {
    const fila = (await this.repositorio.listar()).find((s) => s.id === serieId);
    if (!fila) {
      throw new UnprocessableEntityException(`La serie ${serieId} no existe en el cuadro`);
    }
    if (fila.padreId === null) {
      throw new UnprocessableEntityException(
        `${fila.codigo} es una serie: los documentos se asocian a una subserie`,
      );
    }
  }
}
