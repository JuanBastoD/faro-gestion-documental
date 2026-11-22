import { Inject, Injectable } from '@nestjs/common';
import { DB, type BaseDatos } from '../base-datos/base-datos.module.js';
import { auditoria } from '../base-datos/esquema.js';
import type { Accion } from './acciones.js';

export interface EventoAuditoria {
  /** Quién actuó. Nulo si no se pudo identificar (por ejemplo, un ingreso fallido). */
  usuarioId: number | null;
  accion: Accion;
  documentoId?: number | null;
  detalle?: string | null;
}

/**
 * Cualquier cosa que sepa insertar: la base o una transacción abierta.
 * Así un servicio puede guardar su cambio y su evento de auditoría juntos.
 */
export type EjecutorInsercion = Pick<BaseDatos, 'insert'>;

@Injectable()
export class AuditoriaRepository {
  constructor(@Inject(DB) private readonly db: BaseDatos) {}

  async insertar(evento: EventoAuditoria, ejecutor: EjecutorInsercion = this.db): Promise<void> {
    await ejecutor.insert(auditoria).values({
      usuarioId: evento.usuarioId,
      accion: evento.accion,
      documentoId: evento.documentoId ?? null,
      detalle: evento.detalle ?? null,
    });
  }
}
