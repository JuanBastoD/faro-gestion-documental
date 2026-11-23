import { Inject, Injectable } from '@nestjs/common';
import {
  AuditoriaRepository,
  type EjecutorInsercion,
  type EventoAuditoria,
} from './auditoria.repository.js';

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
}
