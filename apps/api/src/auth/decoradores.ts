import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { Rol, UsuarioSesion } from './roles.js';

export const CLAVE_PUBLICO = 'faro:publico';
export const CLAVE_ROLES = 'faro:roles';
export const CLAVE_PERMITIDO_CON_CLAVE_TEMPORAL = 'faro:permitido-con-clave-temporal';

/** Ruta sin sesión (por ejemplo /health o el ingreso). Por defecto todo exige sesión. */
export const Publico = () => SetMetadata(CLAVE_PUBLICO, true);

/**
 * Ruta que una persona con clave temporal (restablecida por un administrador) sí puede usar antes de cambiarla
 * (ADR-011). Por defecto todo lo que exige sesión queda cerrado para ella con 403 `cambio_de_clave_requerido`:
 * lo que se abre es una lista corta y explícita (quién soy, cerrar sesión, cambiar la clave), nunca una lista de
 * lo que se cierra. Se pone en cada método, no en la clase, para que una ruta nueva no quede abierta sin querer.
 */
export const PermitidoConClaveTemporal = () => SetMetadata(CLAVE_PERMITIDO_CON_CLAVE_TEMPORAL, true);

/** Ruta solo para estos roles. Sin este decorador basta con tener sesión. */
export const Roles = (...roles: Rol[]) => SetMetadata(CLAVE_ROLES, roles);

export type PeticionConUsuario = Request & { usuario?: UsuarioSesion };

/** Inyecta en el método del controlador a quien tiene la sesión. */
export const UsuarioActual = createParamDecorator(
  (_datos: unknown, contexto: ExecutionContext): UsuarioSesion | undefined =>
    contexto.switchToHttp().getRequest<PeticionConUsuario>().usuario,
);
