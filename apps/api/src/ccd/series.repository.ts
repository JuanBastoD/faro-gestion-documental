import { asc } from 'drizzle-orm';
import { Inject, Injectable } from '@nestjs/common';
import { DB, type BaseDatos } from '../base-datos/base-datos.module.js';
import { seriesCcd } from '../base-datos/esquema.js';

export interface FilaSerie {
  id: number;
  codigo: string;
  nombre: string;
  padreId: number | null;
}

@Injectable()
export class SeriesRepository {
  constructor(@Inject(DB) private readonly db: BaseDatos) {}

  /** Todas las series y subseries, ordenadas por código. El cuadro es pequeño: se lee completo. */
  listar(): Promise<FilaSerie[]> {
    return this.db
      .select({
        id: seriesCcd.id,
        codigo: seriesCcd.codigo,
        nombre: seriesCcd.nombre,
        padreId: seriesCcd.padreId,
      })
      .from(seriesCcd)
      .orderBy(asc(seriesCcd.codigo));
  }
}
