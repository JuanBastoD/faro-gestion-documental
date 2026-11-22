import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Request } from 'express';
import { ENTORNO } from '../config/config.module.js';
import type { Entorno } from '../config/entorno.js';
import { origenPermitido } from './origen.js';

/**
 * Guarda global (ADR-009): rechaza con 403 las peticiones que modifican datos y vienen de otro sitio.
 * No escribe en la auditoría: es ruido sin valor documental y cada rechazo sería una escritura en la base
 * que cualquiera puede provocar. Queda en el registro del servidor, sin datos de personas.
 */
@Injectable()
export class OrigenGuard implements CanActivate {
  private readonly registro = new Logger(OrigenGuard.name);

  constructor(@Inject(ENTORNO) private readonly entorno: Entorno) {}

  canActivate(contexto: ExecutionContext): boolean {
    const peticion = contexto.switchToHttp().getRequest<Request>();
    const permitido = origenPermitido(
      {
        metodo: peticion.method,
        origin: peticion.headers.origin,
        host: peticion.headers.host,
        secFetchSite: peticion.headers['sec-fetch-site'] as string | undefined,
      },
      this.entorno.ORIGENES_PERMITIDOS,
    );
    if (!permitido) {
      this.registro.warn(
        `Rechazada ${peticion.method} ${peticion.path}: origen «${String(peticion.headers.origin ?? '(sin Origin)')}», Sec-Fetch-Site «${String(peticion.headers['sec-fetch-site'] ?? '-')}»`,
      );
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        codigo: 'origen_no_permitido',
        message: 'La petición viene de un origen no permitido',
      });
    }
    return true;
  }
}
