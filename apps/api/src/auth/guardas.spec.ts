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
import {
  CLAVE_PERMITIDO_CON_CLAVE_TEMPORAL,
  CLAVE_PUBLICO,
  CLAVE_ROLES,
  type PeticionConUsuario,
} from './decoradores.js';
import { RolesGuard } from './roles.guard.js';
import type { Rol, UsuarioSesion } from './roles.js';

const lector: UsuarioSesion = { id: 3, usuario: 'lector', nombre: 'L', rol: 'consulta', debeCambiarClave: false };
const conClaveTemporal: UsuarioSesion = { ...lector, debeCambiarClave: true };

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

  const auth = (usuario: UsuarioSesion | null) =>
    ({ validarSesion: async () => usuario }) as unknown as AuthService;
  const guarda = (reflector: Reflector, usuario: UsuarioSesion | null) =>
    new AuthGuard(reflector, auth(usuario), auditoria);

  it('deja pasar las rutas públicas sin mirar la cookie', async () => {
    const { contexto, reflector } = armar({ [CLAVE_PUBLICO]: true }, { headers: {} });
    expect(await guarda(reflector, null).canActivate(contexto)).toBe(true);
  });

  it('sin cookie lanza 401', async () => {
    const { contexto, reflector } = armar({}, { headers: {} });
    await expect(guarda(reflector, lector).canActivate(contexto)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('con una cookie de sesión no vigente lanza 401', async () => {
    const { contexto, reflector } = armar({}, { headers: { cookie: 'faro_sesion=abc' } });
    await expect(guarda(reflector, null).canActivate(contexto)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('con una sesión vigente deja pasar y adjunta a la persona a la petición', async () => {
    const peticion: Partial<PeticionConUsuario> = { headers: { cookie: 'x=1; faro_sesion=abc' } };
    const { contexto, reflector } = armar({}, peticion);
    expect(await guarda(reflector, lector).canActivate(contexto)).toBe(true);
    expect(peticion.usuario).toEqual(lector);
    expect(eventos).toEqual([]);
  });

  describe('clave temporal (ADR-011)', () => {
    const peticion = (): Partial<PeticionConUsuario> => ({
      method: 'GET',
      path: '/documentos',
      headers: { cookie: 'faro_sesion=abc' },
    });

    it('en una ruta sin la marca responde 403 cambio_de_clave_requerido y deja acceso_denegado con el motivo', async () => {
      const { contexto, reflector } = armar({}, peticion());
      const error = await guarda(reflector, conClaveTemporal).canActivate(contexto).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        statusCode: 403,
        codigo: 'cambio_de_clave_requerido',
      });
      expect(eventos).toEqual([
        { usuarioId: 3, accion: 'acceso_denegado', detalle: 'GET /documentos; cambio de clave requerido' },
      ]);
    });

    it('lo mismo si la ruta además pide un rol: la condición va antes que la guarda de roles', async () => {
      const { contexto, reflector } = armar({ [CLAVE_ROLES]: ['consulta'] satisfies Rol[] }, peticion());
      await expect(guarda(reflector, conClaveTemporal).canActivate(contexto)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('en una ruta marcada con @PermitidoConClaveTemporal() deja pasar, adjunta a la persona y no audita', async () => {
      const p = peticion();
      const { contexto, reflector } = armar({ [CLAVE_PERMITIDO_CON_CLAVE_TEMPORAL]: true }, p);
      expect(await guarda(reflector, conClaveTemporal).canActivate(contexto)).toBe(true);
      expect(p.usuario).toEqual(conClaveTemporal);
      expect(eventos).toEqual([]);
    });

    it('una ruta pública no se ve afectada (no hay sesión que mirar)', async () => {
      const { contexto, reflector } = armar({ [CLAVE_PUBLICO]: true }, { headers: {} });
      expect(await guarda(reflector, conClaveTemporal).canActivate(contexto)).toBe(true);
    });

    it('sin la marca de clave temporal pendiente, la marca no hace falta', async () => {
      const { contexto, reflector } = armar({}, peticion());
      expect(await guarda(reflector, lector).canActivate(contexto)).toBe(true);
    });

    it('si la auditoría falla, igual responde 403', async () => {
      auditoriaFalla = true;
      const { contexto, reflector } = armar({}, peticion());
      await expect(guarda(reflector, conClaveTemporal).canActivate(contexto)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
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
