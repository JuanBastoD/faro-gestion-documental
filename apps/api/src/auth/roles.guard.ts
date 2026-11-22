import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ACCION } from '../auditoria/acciones.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { CLAVE_ROLES, type PeticionConUsuario } from './decoradores.js';
import type { Rol } from './roles.js';

/**
 * Guarda global que corre después de AuthGuard. Si la ruta declara @Roles(...)
 * y el usuario no tiene uno de ellos, responde 403 y deja el intento en la auditoría.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuditoriaService) private readonly auditoria: AuditoriaService,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const permitidos = this.reflector.getAllAndOverride<Rol[] | undefined>(CLAVE_ROLES, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);
    if (!permitidos || permitidos.length === 0) return true;

    const peticion = contexto.switchToHttp().getRequest<PeticionConUsuario>();
    const usuario = peticion.usuario;
    if (!usuario) {
      // Una ruta con roles que además es @Publico() es un error de programación: se cierra.
      throw new UnauthorizedException('Se requiere iniciar sesión');
    }
    if (permitidos.includes(usuario.rol)) return true;

    try {
      await this.auditoria.registrar({
        usuarioId: usuario.id,
        accion: ACCION.ACCESO_DENEGADO,
        detalle: `${peticion.method} ${peticion.path}; requiere ${permitidos.join(' o ')}; tiene ${usuario.rol}`,
      });
    } catch (error) {
      // Si la auditoría falla, la respuesta sigue siendo 403: el acceso no se concede.
      this.logger.error(
        `No se pudo registrar el acceso denegado: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    throw new ForbiddenException('No tiene permiso para esta acción');
  }
}
