import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import type { AuditoriaService } from '../auditoria/auditoria.service.js';
import type { EventoAuditoria } from '../auditoria/auditoria.repository.js';
import {
  AuthService,
  DURACION_MAXIMA_MS,
  INACTIVIDAD_MS,
  RENOVAR_DESPUES_MS,
  huellaDeToken,
} from './auth.service.js';
import { hashear, verificar } from './hash-clave.js';
import { DemasiadosIntentosError, type LimiteIngreso } from './limite-ingreso.js';
import type { UsuarioSesion } from './roles.js';
import type { SesionVigente, SesionesRepository } from './sesiones.repository.js';
import type { FilaUsuario, Transaccion, UsuariosRepository } from './usuarios.repository.js';

const CLAVE = 'una-clave-larga-de-prueba';
const CLAVE_NUEVA = 'otra-clave-larga-distinta';
const CLAVE_ACTUAL_INCORRECTA = 'no-es-la-clave-actual';
/** Valor de la cookie de la sesión que cambia la clave: su huella es lo que se conserva. */
const SESION_ACTUAL = 'valor-de-la-sesion-actual';
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
  let escrituras: Array<{ id: number; esperada: string; nueva: string }>;
  let conservadas: Array<{ usuarioId: number; conservar: string }>;
  let claveYaCambiada: boolean;
  let eventosEnTransaccion: boolean[];
  let transacciones: number;

  beforeAll(async () => {
    fila = {
      id: 7,
      usuario: 'editor',
      nombre: 'Editor de prueba',
      rol: 'editor',
      claveHash: await hashear(CLAVE),
      activo: true,
      debeCambiarClave: false,
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
    escrituras = [];
    conservadas = [];
    claveYaCambiada = false;
    eventosEnTransaccion = [];
    transacciones = 0;
    const tx = { esTransaccion: true } as unknown as Transaccion;
    const usuarios = {
      buscarPorUsuario: async (nombre: string) => {
        consultados.push(nombre);
        return nombre === 'editor' ? fila : undefined;
      },
      buscarPorId: async (id: number) => (id === fila?.id ? fila : undefined),
      enTransaccion: async <T>(trabajo: (t: Transaccion) => Promise<T>) => {
        transacciones++;
        return trabajo(tx);
      },
      fijarClavePropia: async (_t: Transaccion, id: number, esperada: string, nueva: string) => {
        escrituras.push({ id, esperada, nueva });
        return !claveYaCambiada;
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
      borrarDeUsuarioExcepto: async (_t: Transaccion, usuarioId: number, conservar: string) => {
        conservadas.push({ usuarioId, conservar });
        return 3;
      },
    } as unknown as SesionesRepository;
    const auditoria = {
      registrar: async (e: EventoAuditoria, ejecutor?: unknown) => {
        eventos.push(e);
        eventosEnTransaccion.push(ejecutor === tx);
      },
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
        debeCambiarClave: false,
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
    const usuario: UsuarioSesion = { id: 7, usuario: 'editor', nombre: 'E', rol: 'editor', debeCambiarClave: false };

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
    await servicio.cerrarSesion('token', {
      id: 7,
      usuario: 'editor',
      nombre: 'E',
      rol: 'editor',
      debeCambiarClave: false,
    });
    expect(borradas).toEqual([huellaDeToken('token')]);
    expect(eventos).toEqual([{ usuarioId: 7, accion: 'cierre_sesion' }]);
  });

  describe('cambiarClave (ADR-011)', () => {
    const sesion: UsuarioSesion = { id: 7, usuario: 'editor', nombre: 'E', rol: 'editor', debeCambiarClave: false };

    it('con la clave actual correcta guarda un hash argon2id nuevo, conserva la sesión actual y audita en la transacción', async () => {
      const cerradas = await servicio.cambiarClave(sesion, SESION_ACTUAL, CLAVE, CLAVE_NUEVA, IP);
      expect(cerradas).toBe(3);
      expect(escrituras).toHaveLength(1);
      expect(escrituras[0].id).toBe(7);
      expect(escrituras[0].esperada).toBe(fila?.claveHash);
      expect(escrituras[0].nueva).toMatch(/^\$argon2id\$/);
      expect(escrituras[0].nueva).not.toContain(CLAVE_NUEVA);
      expect(await verificar(escrituras[0].nueva, CLAVE_NUEVA)).toBe(true);
      // Las demás sesiones se cierran dejando la de la huella del token actual.
      expect(conservadas).toEqual([{ usuarioId: 7, conservar: huellaDeToken(SESION_ACTUAL) }]);
      expect(transacciones).toBe(1);
      expect(eventos).toEqual([{ usuarioId: 7, accion: 'clave_cambiada', detalle: 'otras sesiones cerradas: 3' }]);
      expect(eventosEnTransaccion).toEqual([true]);
    });

    it('reserva el intento con el nombre de la persona y la IP, y un cambio correcto la perdona', async () => {
      await servicio.cambiarClave(sesion, SESION_ACTUAL, CLAVE, CLAVE_NUEVA, IP);
      expect(reservas).toEqual([{ usuario: 'editor', ip: IP }]);
      expect(perdonados).toEqual(['editor']);
    });

    it('con la clave actual incorrecta responde 400 clave_actual_incorrecta (nunca 401), no cambia nada y audita el fallo', async () => {
      const error = await servicio.cambiarClave(sesion, SESION_ACTUAL, CLAVE_ACTUAL_INCORRECTA, CLAVE_NUEVA, IP).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        statusCode: 400,
        codigo: 'clave_actual_incorrecta',
      });
      expect(escrituras).toEqual([]);
      expect(conservadas).toEqual([]);
      expect(transacciones).toBe(0);
      expect(perdonados).toEqual([]);
      expect(eventos).toEqual([
        { usuarioId: 7, accion: 'ingreso_fallido', detalle: 'cambio de clave: clave actual incorrecta' },
      ]);
      expect(JSON.stringify(eventos)).not.toContain(CLAVE_ACTUAL_INCORRECTA);
    });

    it('el fallo que agota el límite audita ingreso_bloqueado', async () => {
      alcanzados = ['usuario'];
      await servicio.cambiarClave(sesion, SESION_ACTUAL, CLAVE_ACTUAL_INCORRECTA, CLAVE_NUEVA, IP).catch(() => undefined);
      expect(eventos.map((e) => e.accion)).toEqual(['ingreso_fallido', 'ingreso_bloqueado']);
      expect(eventos[1].detalle).toBe('límite de intentos alcanzado por usuario');
    });

    it('si el límite está agotado, no consulta ni verifica la clave, no audita y no cambia nada', async () => {
      bloqueo = new DemasiadosIntentosError(120);
      const error = await servicio.cambiarClave(sesion, SESION_ACTUAL, CLAVE, CLAVE_NUEVA, IP).catch((e: unknown) => e);
      expect(error).toBe(bloqueo);
      expect(escrituras).toEqual([]);
      expect(eventos).toEqual([]);
      expect(transacciones).toBe(0);
    });

    it('si otra petición cambió la clave entre la verificación y la escritura: 409 y no se cierra ninguna sesión ni se audita', async () => {
      claveYaCambiada = true;
      const error = await servicio.cambiarClave(sesion, SESION_ACTUAL, CLAVE, CLAVE_NUEVA, IP).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({ codigo: 'conflicto_de_clave' });
      expect(conservadas).toEqual([]);
      expect(eventos).toEqual([]);
    });

    it('si la persona ya no existe o está inactiva, 401 (la sesión ya no vale) y no cuenta como clave incorrecta', async () => {
      const original = fila;
      fila = { ...original!, activo: false };
      try {
        await expect(servicio.cambiarClave(sesion, SESION_ACTUAL, CLAVE, CLAVE_NUEVA, IP)).rejects.toBeInstanceOf(
          UnauthorizedException,
        );
        expect(eventos).toEqual([]);
      } finally {
        fila = original;
      }
    });
  });
});
