import { and, count, desc, eq, gte, lte, type SQL } from 'drizzle-orm';
import { Inject, Injectable } from '@nestjs/common';
import { DB, type BaseDatos } from '../base-datos/base-datos.module.js';
import { auditoria, usuarios } from '../base-datos/esquema.js';
import type { Accion } from './acciones.js';
import type { FiltrosAuditoria } from './filtros-auditoria.js';

export interface EventoAuditoria {
  /** Quién actuó. Nulo si no se pudo identificar (por ejemplo, un ingreso fallido). */
  usuarioId: number | null;
  accion: Accion;
  documentoId?: number | null;
  detalle?: string | null;
}

export interface EventoConsultado {
  id: number;
  usuarioId: number | null;
  /** Nombre de usuario de quien actuó, si se conoce. */
  usuario: string | null;
  accion: string;
  documentoId: number | null;
  detalle: string | null;
  creadoEn: Date;
}

export interface PaginaDeEventos {
  items: EventoConsultado[];
  total: number;
  pagina: number;
  tamano: number;
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

  /** Los más recientes primero; el id desempata para que las páginas no repitan ni pierdan eventos. */
  async consultar(filtros: FiltrosAuditoria): Promise<PaginaDeEventos> {
    const condiciones: SQL[] = [];
    if (filtros.usuarioId !== undefined) condiciones.push(eq(auditoria.usuarioId, filtros.usuarioId));
    if (filtros.accion !== undefined) condiciones.push(eq(auditoria.accion, filtros.accion));
    if (filtros.documentoId !== undefined) {
      condiciones.push(eq(auditoria.documentoId, filtros.documentoId));
    }
    if (filtros.desde !== undefined) condiciones.push(gte(auditoria.creadoEn, filtros.desde));
    if (filtros.hasta !== undefined) condiciones.push(lte(auditoria.creadoEn, filtros.hasta));
    const donde = condiciones.length > 0 ? and(...condiciones) : undefined;

    const items = await this.db
      .select({
        id: auditoria.id,
        usuarioId: auditoria.usuarioId,
        usuario: usuarios.usuario,
        accion: auditoria.accion,
        documentoId: auditoria.documentoId,
        detalle: auditoria.detalle,
        creadoEn: auditoria.creadoEn,
      })
      .from(auditoria)
      .leftJoin(usuarios, eq(usuarios.id, auditoria.usuarioId))
      .where(donde)
      .orderBy(desc(auditoria.creadoEn), desc(auditoria.id))
      .limit(filtros.tamano)
      .offset((filtros.pagina - 1) * filtros.tamano);

    const [{ total }] = await this.db.select({ total: count() }).from(auditoria).where(donde);
    return { items, total, pagina: filtros.pagina, tamano: filtros.tamano };
  }
}
