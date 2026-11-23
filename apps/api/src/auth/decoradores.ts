import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { Rol, UsuarioSesion } from './roles.js';

export const CLAVE_PUBLICO = 'faro:publico';
export const CLAVE_ROLES = 'faro:roles';

/** Ruta sin sesión (por ejemplo /health o el ingreso). Por defecto todo exige sesión. */
export const Publico = () => SetMetadata(CLAVE_PUBLICO, true);

/** Ruta solo para estos roles. Sin este decorador basta con tener sesión. */
export const Roles = (...roles: Rol[]) => SetMetadata(CLAVE_ROLES, roles);

export type PeticionConUsuario = Request & { usuario?: UsuarioSesion };

/** Inyecta en el método del controlador a quien tiene la sesión. */
export const UsuarioActual = createParamDecorator(
  (_datos: unknown, contexto: ExecutionContext): UsuarioSesion | undefined =>
    contexto.switchToHttp().getRequest<PeticionConUsuario>().usuario,
);
