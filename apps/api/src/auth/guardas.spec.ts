import {
  ForbiddenException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { AuditoriaService } from '../auditoria/auditoria.service.js';
import type { EventoAuditoria } from '../auditoria/auditoria.repository.js';
import { AuthGuard } from './auth.guard.js';
import type { AuthService } from './auth.service.js';
import { CLAVE_PUBLICO, CLAVE_ROLES, type PeticionConUsuario } from './decoradores.js';
import { RolesGuard } from './roles.guard.js';
import type { Rol, UsuarioSesion } from './roles.js';

const lector: UsuarioSesion = { id: 3, usuario: 'lector', nombre: 'L', rol: 'consulta' };

/** Un contexto de ejecución mínimo y un Reflector que responde según la clave de metadatos. */
function armar(metadatos: Record<string, unknown>, peticion: Partial<PeticionConUsuario>) {
  const contexto = {
    getHandler: () => 'handler',
    getClass: () => 'clase',
    switchToHttp: () => ({ getRequest: () => peticion }),
  } as unknown as ExecutionContext;
  const reflector = {
    getAllAndOverride: (clave: string) => metadatos[clave],
  } as unknown as Reflector;
  return { contexto, reflector };
}

describe('AuthGuard', () => {
  const auth = (usuario: UsuarioSesion | null) =>
    ({ validarSesion: async () => usuario }) as unknown as AuthService;

  it('deja pasar las rutas públicas sin mirar la cookie', async () => {
    const { contexto, reflector } = armar({ [CLAVE_PUBLICO]: true }, { headers: {} });
    expect(await new AuthGuard(reflector, auth(null)).canActivate(contexto)).toBe(true);
  });

  it('sin cookie lanza 401', async () => {
    const { contexto, reflector } = armar({}, { headers: {} });
    await expect(new AuthGuard(reflector, auth(lector)).canActivate(contexto)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('con una cookie de sesión no vigente lanza 401', async () => {
    const { contexto, reflector } = armar({}, { headers: { cookie: 'faro_sesion=abc' } });
    await expect(new AuthGuard(reflector, auth(null)).canActivate(contexto)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('con una sesión vigente deja pasar y adjunta a la persona a la petición', async () => {
    const peticion: Partial<PeticionConUsuario> = { headers: { cookie: 'x=1; faro_sesion=abc' } };
    const { contexto, reflector } = armar({}, peticion);
    expect(await new AuthGuard(reflector, auth(lector)).canActivate(contexto)).toBe(true);
    expect(peticion.usuario).toEqual(lector);
  });
});

describe('RolesGuard', () => {
  let eventos: EventoAuditoria[];
  let auditoriaFalla: boolean;
  const auditoria = {
    registrar: async (e: EventoAuditoria) => {
      if (auditoriaFalla) throw new Error('base caída');
      eventos.push(e);
    },
  } as unknown as AuditoriaService;

  beforeEach(() => {
    eventos = [];
    auditoriaFalla = false;
  });

  const peticion = (usuario?: UsuarioSesion): Partial<PeticionConUsuario> => ({
    method: 'GET',
    path: '/x',
    usuario,
  });

  it('sin @Roles basta con tener sesión', async () => {
    const { contexto, reflector } = armar({}, peticion(lector));
    expect(await new RolesGuard(reflector, auditoria).canActivate(contexto)).toBe(true);
  });

  it('con un rol permitido deja pasar y no audita', async () => {
    const { contexto, reflector } = armar(
      { [CLAVE_ROLES]: ['consulta', 'editor'] satisfies Rol[] },
      peticion(lector),
    );
    expect(await new RolesGuard(reflector, auditoria).canActivate(contexto)).toBe(true);
    expect(eventos).toHaveLength(0);
  });

  it('con un rol no permitido lanza 403 y registra el intento', async () => {
    const { contexto, reflector } = armar(
      { [CLAVE_ROLES]: ['administrador'] satisfies Rol[] },
      peticion(lector),
    );
    await expect(new RolesGuard(reflector, auditoria).canActivate(contexto)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(eventos).toEqual([
      {
        usuarioId: 3,
        accion: 'acceso_denegado',
        detalle: 'GET /x; requiere administrador; tiene consulta',
      },
    ]);
  });

  it('si no se puede registrar el intento, igual lanza 403', async () => {
    auditoriaFalla = true;
    const { contexto, reflector } = armar(
      { [CLAVE_ROLES]: ['administrador'] satisfies Rol[] },
      peticion(lector),
    );
    await expect(new RolesGuard(reflector, auditoria).canActivate(contexto)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('una ruta con roles pero sin persona identificada lanza 401', async () => {
    const { contexto, reflector } = armar(
      { [CLAVE_ROLES]: ['administrador'] satisfies Rol[] },
      peticion(undefined),
    );
    await expect(new RolesGuard(reflector, auditoria).canActivate(contexto)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
