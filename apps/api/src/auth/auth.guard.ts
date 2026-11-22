import {
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from './auth.service.js';
import { COOKIE_SESION, leerCookie } from './cookie-sesion.js';
import { CLAVE_PUBLICO, type PeticionConUsuario } from './decoradores.js';

/** Guarda global: todo exige una sesión vigente salvo lo marcado con @Publico(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthService) private readonly auth: AuthService,
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
    return true;
  }
}
