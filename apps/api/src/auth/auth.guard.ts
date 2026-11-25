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
import { AuthService } from './auth.service.js';
import { COOKIE_SESION, leerCookie } from './cookie-sesion.js';
import {
  CLAVE_PERMITIDO_CON_CLAVE_TEMPORAL,
  CLAVE_PUBLICO,
  type PeticionConUsuario,
} from './decoradores.js';

/**
 * Guarda global: todo exige una sesión vigente salvo lo marcado con @Publico().
 *
 * Además, quien tiene una clave temporal (`debeCambiarClave`, ADR-011) solo pasa por las rutas marcadas con
 * @PermitidoConClaveTemporal(); en las demás recibe 403 `cambio_de_clave_requerido`. Va aquí, antes de la
 * guarda de roles, para que ninguna ruta (ni siquiera una que solo pida un rol) se salte la condición.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AuditoriaService) private readonly auditoria: AuditoriaService,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const esPublico = this.reflector.getAllAndOverride<boolean | undefined>(CLAVE_PUBLICO, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);
    if (esPublico) return true;

    const peticion = contexto.switchToHttp().getRequest<PeticionConUsuario>();
    const token = leerCookie(peticion.headers.cookie, COOKIE_SESION);
    const usuario = token ? await this.auth.validarSesion(token) : null;
    if (!usuario) {
      throw new UnauthorizedException('Se requiere iniciar sesión');
    }
    peticion.usuario = usuario;

    if (usuario.debeCambiarClave) {
      const permitido = this.reflector.getAllAndOverride<boolean | undefined>(
        CLAVE_PERMITIDO_CON_CLAVE_TEMPORAL,
        [contexto.getHandler(), contexto.getClass()],
      );
      if (!permitido) await this.denegarPorClaveTemporal(peticion, usuario.id);
    }
    return true;
  }

  private async denegarPorClaveTemporal(peticion: PeticionConUsuario, usuarioId: number): Promise<never> {
    try {
      await this.auditoria.registrar({
        usuarioId,
        accion: ACCION.ACCESO_DENEGADO,
        detalle: `${peticion.method} ${peticion.path}; cambio de clave requerido`,
      });
    } catch (error) {
      // Si la auditoría falla, la respuesta sigue siendo 403: el acceso no se concede.
      this.logger.error(
        `No se pudo registrar el acceso denegado: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    throw new ForbiddenException({
      statusCode: 403,
      error: 'Forbidden',
      codigo: 'cambio_de_clave_requerido',
      message: 'Debes cambiar la clave temporal antes de continuar',
    });
  }
}
