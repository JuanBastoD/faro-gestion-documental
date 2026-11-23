import { Inject, Injectable } from '@nestjs/common';
import {
  AuditoriaRepository,
  type EjecutorInsercion,
  type EventoAuditoria,
  type PaginaDeEventos,
} from './auditoria.repository.js';
import type { FiltrosAuditoria } from './filtros-auditoria.js';

@Injectable()
export class AuditoriaService {
  constructor(@Inject(AuditoriaRepository) private readonly repositorio: AuditoriaRepository) {}

  /**
   * Registra un evento. Si se pasa `ejecutor` (una transacción), el evento queda
   * en la misma transacción que el cambio que lo origina.
   * Nunca incluir claves, tokens ni el contenido de los documentos en `detalle`.
   */
  registrar(evento: EventoAuditoria, ejecutor?: EjecutorInsercion): Promise<void> {
    return this.repositorio.insertar(evento, ejecutor);
  }

  /** Solo lectura: la auditoría no ofrece editar ni borrar eventos. */
  consultar(filtros: FiltrosAuditoria): Promise<PaginaDeEventos> {
    return this.repositorio.consultar(filtros);
  }
}
