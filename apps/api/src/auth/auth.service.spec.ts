import { UnauthorizedException } from '@nestjs/common';
import type { AuditoriaService } from '../auditoria/auditoria.service.js';
import type { EventoAuditoria } from '../auditoria/auditoria.repository.js';
import {
  AuthService,
  DURACION_MAXIMA_MS,
  INACTIVIDAD_MS,
  RENOVAR_DESPUES_MS,
  huellaDeToken,
} from './auth.service.js';
import { hashear } from './hash-clave.js';
import { DemasiadosIntentosError, type LimiteIngreso } from './limite-ingreso.js';
import type { UsuarioSesion } from './roles.js';
import type { SesionVigente, SesionesRepository } from './sesiones.repository.js';
import type { FilaUsuario, UsuariosRepository } from './usuarios.repository.js';

const CLAVE = 'una-clave-larga-de-prueba';
const IP = '203.0.113.7';

describe('AuthService', () => {
  let fila: FilaUsuario | undefined;
  let eventos: EventoAuditoria[];
  let creadas: Array<{ id: string; usuarioId: number; venceEn: Date }>;
  let renovadas: Array<{ id: string; venceEn: Date }>;
  let borradas: string[];
  let vigente: SesionVigente | undefined;
  let creadaDespuesDe: Date | undefined;
  let servicio: AuthService;
  let consultados: string[];
  let reservas: Array<{ usuario: string; ip: string }>;
  let perdonados: string[];
  let bloqueo: DemasiadosIntentosError | undefined;
  let alcanzados: Array<'usuario' | 'ip'>;

  beforeAll(async () => {
    fila = {
      id: 7,
      usuario: 'editor',
      nombre: 'Editor de prueba',
      rol: 'editor',
      claveHash: await hashear(CLAVE),
      activo: true,
    };
  });

  beforeEach(() => {
    eventos = [];
    creadas = [];
    renovadas = [];
    borradas = [];
    vigente = undefined;
    creadaDespuesDe = undefined;
    consultados = [];
    reservas = [];
    perdonados = [];
    bloqueo = undefined;
    alcanzados = [];
    const usuarios = {
      buscarPorUsuario: async (nombre: string) => {
        consultados.push(nombre);
        return nombre === 'editor' ? fila : undefined;
      },
    } as unknown as UsuariosRepository;
    const limite = {
      reservar: async (usuario: string, ip: string) => {
        reservas.push({ usuario, ip });
        if (bloqueo) throw bloqueo;
        return { alcanzados };
      },
      perdonar: async (usuario: string) => void perdonados.push(usuario),
    } as unknown as LimiteIngreso;
    const sesiones = {
      crear: async (s: { id: string; usuarioId: number; venceEn: Date }) => void creadas.push(s),
      buscarVigente: async (_id: string, _ahora: Date, despuesDe: Date) => {
        creadaDespuesDe = despuesDe;
        return vigente;
      },
      renovar: async (id: string, _ahora: Date, venceEn: Date) => void renovadas.push({ id, venceEn }),
      borrar: async (id: string) => void borradas.push(id),
      borrarVencidasDe: async () => {},
    } as unknown as SesionesRepository;
    const auditoria = {
      registrar: async (e: EventoAuditoria) => void eventos.push(e),
    } as unknown as AuditoriaService;
    servicio = new AuthService(usuarios, sesiones, auditoria, limite);
  });

  describe('ingresar', () => {
    it('con la clave correcta crea la sesión con la huella del token y audita el ingreso', async () => {
      const { token, usuario } = await servicio.ingresar('editor', CLAVE, IP);
      expect(token).toMatch(/^[0-9a-f]{64}$/);
      expect(usuario).toEqual({
        id: 7,
        usuario: 'editor',
        nombre: 'Editor de prueba',
        rol: 'editor',
      });
      expect(creadas).toHaveLength(1);
      expect(creadas[0].id).toBe(huellaDeToken(token));
      expect(creadas[0].id).not.toBe(token);
      const duracion = creadas[0].venceEn.getTime() - Date.now();
      expect(duracion).toBeGreaterThan(INACTIVIDAD_MS - 5000);
      expect(duracion).toBeLessThanOrEqual(INACTIVIDAD_MS);
      expect(eventos).toEqual([{ usuarioId: 7, accion: 'ingreso' }]);
    });

    it('cada ingreso genera un token distinto', async () => {
      const a = await servicio.ingresar('editor', CLAVE, IP);
      const b = await servicio.ingresar('editor', CLAVE, IP);
      expect(a.token).not.toBe(b.token);
    });

    it('con una clave incorrecta lanza 401 y no crea sesión', async () => {
      await expect(servicio.ingresar('editor', 'incorrecta', IP)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(creadas).toHaveLength(0);
      expect(eventos).toEqual([
        { usuarioId: 7, accion: 'ingreso_fallido', detalle: 'clave incorrecta' },
      ]);
    });

    it('con un usuario inexistente lanza el mismo 401 y audita sin el nombre escrito', async () => {
      const error = await servicio.ingresar('quien-sea', CLAVE, IP).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(UnauthorizedException);
      expect((error as UnauthorizedException).message).toBe('Usuario o clave incorrectos');
      expect(eventos).toEqual([
        { usuarioId: null, accion: 'ingreso_fallido', detalle: 'usuario inexistente' },
      ]);
      expect(JSON.stringify(eventos)).not.toContain('quien-sea');
    });

    describe('límite de intentos (ADR-009)', () => {
      it('reserva el intento con el usuario y la IP recibidos', async () => {
        await servicio.ingresar('editor', CLAVE, IP);
        expect(reservas).toEqual([{ usuario: 'editor', ip: IP }]);
      });

      it('si el límite está agotado, no consulta al usuario, no verifica la clave y no audita', async () => {
        bloqueo = new DemasiadosIntentosError(120);
        const error = await servicio.ingresar('editor', CLAVE, IP).catch((e: unknown) => e);
        expect(error).toBe(bloqueo);
        expect(consultados).toEqual([]);
        expect(creadas).toHaveLength(0);
        expect(eventos).toEqual([]);
      });

      it('un ingreso correcto perdona al usuario', async () => {
        await servicio.ingresar('editor', CLAVE, IP);
        expect(perdonados).toEqual(['editor']);
      });

      it('un ingreso fallido no perdona a nadie', async () => {
        await servicio.ingresar('editor', 'incorrecta', IP).catch(() => undefined);
        expect(perdonados).toEqual([]);
      });

      it('el intento fallido que agota el límite audita ingreso_bloqueado, sin el nombre escrito', async () => {
        alcanzados = ['usuario', 'ip'];
        await servicio.ingresar('quien-sea', CLAVE, IP).catch(() => undefined);
        expect(eventos).toEqual([
          { usuarioId: null, accion: 'ingreso_fallido', detalle: 'usuario inexistente' },
          { usuarioId: null, accion: 'ingreso_bloqueado', detalle: 'límite de intentos alcanzado por usuario e ip' },
        ]);
        expect(JSON.stringify(eventos)).not.toContain('quien-sea');
      });

      it('si el intento que agota el límite resulta correcto, no se audita bloqueo', async () => {
        alcanzados = ['usuario'];
        await servicio.ingresar('editor', CLAVE, IP);
        expect(eventos.map((e) => e.accion)).toEqual(['ingreso']);
      });
    });

    it('con un usuario inactivo no ingresa aunque la clave sea correcta', async () => {
      const original = fila;
      fila = { ...original!, activo: false };
      try {
        await expect(servicio.ingresar('editor', CLAVE, IP)).rejects.toBeInstanceOf(
          UnauthorizedException,
        );
        expect(creadas).toHaveLength(0);
        expect(eventos[0]).toMatchObject({ accion: 'ingreso_fallido', detalle: 'usuario inactivo' });
      } finally {
        fila = original;
      }
    });
  });

  describe('validarSesion', () => {
    const usuario: UsuarioSesion = { id: 7, usuario: 'editor', nombre: 'E', rol: 'editor' };

    it('sin sesión vigente devuelve null', async () => {
      expect(await servicio.validarSesion('token')).toBeNull();
    });

    it('exige que la sesión no supere la duración máxima', async () => {
      await servicio.validarSesion('token');
      const antiguedad = Date.now() - (creadaDespuesDe?.getTime() ?? 0);
      expect(Math.abs(antiguedad - DURACION_MAXIMA_MS)).toBeLessThan(5000);
    });

    it('si se usó hace poco devuelve la persona sin escribir en la base', async () => {
      vigente = { usuario, ultimoUso: new Date(Date.now() - 1000) };
      expect(await servicio.validarSesion('token')).toEqual(usuario);
      expect(renovadas).toHaveLength(0);
    });

    it('si pasó más de un minuto desde el último uso renueva la vigencia', async () => {
      vigente = { usuario, ultimoUso: new Date(Date.now() - RENOVAR_DESPUES_MS - 1000) };
      expect(await servicio.validarSesion('token')).toEqual(usuario);
      expect(renovadas).toHaveLength(1);
      expect(renovadas[0].id).toBe(huellaDeToken('token'));
      expect(renovadas[0].venceEn.getTime() - Date.now()).toBeGreaterThan(INACTIVIDAD_MS - 5000);
    });
  });

  it('cerrarSesion borra por huella y audita', async () => {
    await servicio.cerrarSesion('token', { id: 7, usuario: 'editor', nombre: 'E', rol: 'editor' });
    expect(borradas).toEqual([huellaDeToken('token')]);
    expect(eventos).toEqual([{ usuarioId: 7, accion: 'cierre_sesion' }]);
  });
});
