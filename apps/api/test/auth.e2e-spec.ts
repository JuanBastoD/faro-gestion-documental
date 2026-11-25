import { createHash } from 'node:crypto';
import { Controller, Get } from '@nestjs/common';
import request from 'supertest';
import { Roles } from '../src/auth/decoradores.js';
import type { Rol } from '../src/auth/roles.js';
import {
  CLAVE_DE_PRUEBA,
  cookieDe,
  crearApp,
  crearUsuario,
  eventos,
  ingresar,
  limpiarTablas,
  type AppDePrueba,
} from './ayudas.js';

/** Rutas que existen solo en esta prueba, una por combinación de roles. */
@Controller('prueba')
class ControladorDePrueba {
  @Get('cualquiera')
  cualquiera() {
    return { ok: true };
  }

  @Roles('administrador')
  @Get('administracion')
  administracion() {
    return { ok: true };
  }

  @Roles('administrador', 'editor')
  @Get('escritura')
  escritura() {
    return { ok: true };
  }

  @Roles('consulta')
  @Get('solo-consulta')
  soloConsulta() {
    return { ok: true };
  }
}

const huella = (token: string) => createHash('sha256').update(token).digest('hex');

describe('Ingreso, sesiones y roles (contra PostgreSQL real)', () => {
  let ctx: AppDePrueba;

  beforeAll(async () => {
    ctx = await crearApp([ControladorDePrueba]);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await limpiarTablas(ctx.pool);
    await crearUsuario(ctx.db, { usuario: 'admin', rol: 'administrador' });
    await crearUsuario(ctx.db, { usuario: 'editor', rol: 'editor' });
    await crearUsuario(ctx.db, { usuario: 'lector', rol: 'consulta' });
    await crearUsuario(ctx.db, { usuario: 'baja', rol: 'editor', activo: false });
  });

  const http = () => request(ctx.app.getHttpServer());

  describe('ingreso', () => {
    it('con credenciales correctas devuelve la persona y una cookie httpOnly', async () => {
      const respuesta = await http()
        .post('/auth/login')
        .send({ usuario: 'editor', clave: CLAVE_DE_PRUEBA })
        .expect(200);
      expect(respuesta.body.usuario).toMatchObject({ usuario: 'editor', rol: 'editor' });
      // Lista cerrada de campos: ninguno es la clave ni su hash («debeCambiarClave» es solo un aviso, ADR-011).
      expect(Object.keys(respuesta.body.usuario as object).sort()).toEqual([
        'debeCambiarClave',
        'id',
        'nombre',
        'rol',
        'usuario',
      ]);
      expect(JSON.stringify(respuesta.body)).not.toMatch(/hash|argon2|"clave"/i);
      const cookie = (respuesta.headers['set-cookie'] as unknown as string[])[0];
      expect(cookie).toMatch(/^faro_sesion=[0-9a-f]{64};/);
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/SameSite=Lax/);
      expect(cookie).toMatch(/Path=\//);
    });

    it('en la base solo queda la huella del token, nunca el token', async () => {
      const cookie = await ingresar(ctx.app, 'editor');
      const token = cookie.split('=')[1];
      const { rows } = await ctx.pool.query('select id from sesiones');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(huella(token));
      expect(rows[0].id).not.toBe(token);
    });

    it('la clave se guarda con argon2id', async () => {
      const { rows } = await ctx.pool.query(
        `select clave_hash from usuarios where usuario = 'editor'`,
      );
      expect(rows[0].clave_hash).toMatch(/^\$argon2id\$/);
    });

    it.each([
      ['clave incorrecta', { usuario: 'editor', clave: 'otra-clave-distinta' }],
      ['usuario inexistente', { usuario: 'nadie', clave: CLAVE_DE_PRUEBA }],
      ['usuario inactivo con la clave correcta', { usuario: 'baja', clave: CLAVE_DE_PRUEBA }],
    ])('rechaza con 401 y el mismo mensaje: %s', async (_caso, credenciales) => {
      const respuesta = await http().post('/auth/login').send(credenciales).expect(401);
      expect(respuesta.body.message).toBe('Usuario o clave incorrectos');
      expect(respuesta.headers['set-cookie']).toBeUndefined();
      const { rows } = await ctx.pool.query('select count(*)::int as n from sesiones');
      expect(rows[0].n).toBe(0);
    });

    it('registra los ingresos fallidos sin guardar el nombre escrito', async () => {
      await http().post('/auth/login').send({ usuario: 'nadie', clave: 'x' }).expect(401);
      await http().post('/auth/login').send({ usuario: 'editor', clave: 'x' }).expect(401);
      await http().post('/auth/login').send({ usuario: 'baja', clave: CLAVE_DE_PRUEBA }).expect(401);
      const fallidos = await eventos(ctx.pool, 'ingreso_fallido');
      expect(fallidos.map((e) => e.detalle)).toEqual([
        'usuario inexistente',
        'clave incorrecta',
        'usuario inactivo',
      ]);
      expect(fallidos[0].usuario_id).toBeNull();
      expect(fallidos[1].usuario_id).not.toBeNull();
      expect(JSON.stringify(fallidos)).not.toContain('nadie');
    });

    it('registra el ingreso correcto', async () => {
      await ingresar(ctx.app, 'admin');
      const ingresos = await eventos(ctx.pool, 'ingreso');
      expect(ingresos).toHaveLength(1);
    });

    it.each([
      ['sin cuerpo', undefined],
      ['sin clave', { usuario: 'editor' }],
      ['usuario vacío', { usuario: '  ', clave: 'x' }],
      ['clave demasiado larga', { usuario: 'editor', clave: 'x'.repeat(257) }],
      ['tipos incorrectos', { usuario: 123, clave: true }],
    ])('responde 400 si los datos son inválidos: %s', async (_caso, cuerpo) => {
      await http().post('/auth/login').send(cuerpo).expect(400);
    });
  });

  describe('sesión', () => {
    it('sin cookie las rutas protegidas responden 401', async () => {
      await http().get('/auth/yo').expect(401);
      await http().get('/prueba/cualquiera').expect(401);
    });

    it('con una cookie inventada responde 401', async () => {
      await http().get('/auth/yo').set('Cookie', `faro_sesion=${'a'.repeat(64)}`).expect(401);
    });

    it('/health sigue siendo público', async () => {
      await http().get('/health').expect(200);
    });

    it('GET /auth/yo devuelve quién tiene la sesión', async () => {
      const cookie = await ingresar(ctx.app, 'lector');
      const respuesta = await http().get('/auth/yo').set('Cookie', cookie).expect(200);
      expect(respuesta.body.usuario).toMatchObject({ usuario: 'lector', rol: 'consulta' });
    });

    it('el cierre de sesión invalida la cookie, la borra y queda registrado', async () => {
      const cookie = await ingresar(ctx.app, 'editor');
      const salida = await http().post('/auth/logout').set('Cookie', cookie).expect(204);
      const borrada = (salida.headers['set-cookie'] as unknown as string[])[0];
      expect(borrada).toMatch(/^faro_sesion=;/);
      await http().get('/auth/yo').set('Cookie', cookie).expect(401);
      expect(await eventos(ctx.pool, 'cierre_sesion')).toHaveLength(1);
      const { rows } = await ctx.pool.query('select count(*)::int as n from sesiones');
      expect(rows[0].n).toBe(0);
    });

    it('cerrar sesión sin haber ingresado responde 401', async () => {
      await http().post('/auth/logout').expect(401);
    });

    it('dos sesiones de la misma persona son independientes', async () => {
      const a = await ingresar(ctx.app, 'editor');
      const b = await ingresar(ctx.app, 'editor');
      expect(a).not.toBe(b);
      await http().post('/auth/logout').set('Cookie', a).expect(204);
      await http().get('/auth/yo').set('Cookie', a).expect(401);
      await http().get('/auth/yo').set('Cookie', b).expect(200);
    });

    it('una sesión vencida por inactividad ya no sirve', async () => {
      const cookie = await ingresar(ctx.app, 'editor');
      await http().get('/auth/yo').set('Cookie', cookie).expect(200);
      await ctx.pool.query(`update sesiones set vence_en = now() - interval '1 minute'`);
      await http().get('/auth/yo').set('Cookie', cookie).expect(401);
    });

    it('una sesión que supera los 7 días no sirve aunque se use', async () => {
      const cookie = await ingresar(ctx.app, 'editor');
      await ctx.pool.query(`update sesiones set creada_en = now() - interval '8 days'`);
      await http().get('/auth/yo').set('Cookie', cookie).expect(401);
    });

    it('usarla renueva su vigencia (como mucho una vez por minuto)', async () => {
      const cookie = await ingresar(ctx.app, 'editor');
      await ctx.pool.query(
        `update sesiones set ultimo_uso = now() - interval '5 minutes',
                             vence_en = now() + interval '1 hour'`,
      );
      await http().get('/auth/yo').set('Cookie', cookie).expect(200);
      const { rows } = await ctx.pool.query(
        `select (vence_en > now() + interval '7 hours') as renovada from sesiones`,
      );
      expect(rows[0].renovada).toBe(true);
    });

    it('desactivar a la persona cierra sus sesiones al instante', async () => {
      const cookie = await ingresar(ctx.app, 'editor');
      await http().get('/auth/yo').set('Cookie', cookie).expect(200);
      await ctx.pool.query(`update usuarios set activo = false where usuario = 'editor'`);
      await http().get('/auth/yo').set('Cookie', cookie).expect(401);
    });

    it('la sesión sobrevive a reiniciar la aplicación y sirve en otra instancia', async () => {
      const cookie = await ingresar(ctx.app, 'admin');

      // Una segunda instancia (otro pool, otra aplicación) sobre la misma base.
      const otra = await crearApp([ControladorDePrueba]);
      try {
        const respuesta = await request(otra.app.getHttpServer())
          .get('/auth/yo')
          .set('Cookie', cookie)
          .expect(200);
        expect(respuesta.body.usuario.usuario).toBe('admin');
      } finally {
        await otra.app.close();
      }

      // Y la primera, la "reiniciada", también la reconoce porque no guarda nada en memoria.
      await http().get('/auth/yo').set('Cookie', cookie).expect(200);
    });
  });

  describe('roles', () => {
    // true = permitido (200); false = 403.
    const matriz: Array<[ruta: string, permitidos: Record<Rol, boolean>]> = [
      ['/prueba/cualquiera', { administrador: true, editor: true, consulta: true }],
      ['/prueba/administracion', { administrador: true, editor: false, consulta: false }],
      ['/prueba/escritura', { administrador: true, editor: true, consulta: false }],
      ['/prueba/solo-consulta', { administrador: false, editor: false, consulta: true }],
    ];
    const usuarioDe: Record<Rol, string> = {
      administrador: 'admin',
      editor: 'editor',
      consulta: 'lector',
    };

    for (const rol of ['administrador', 'editor', 'consulta'] as const) {
      it(`el rol ${rol} recibe 200 o 403 según la ruta`, async () => {
        const cookie = await ingresar(ctx.app, usuarioDe[rol]);
        for (const [ruta, permitidos] of matriz) {
          await http()
            .get(ruta)
            .set('Cookie', cookie)
            .expect(permitidos[rol] ? 200 : 403);
        }
      });
    }

    it('el 403 deja un evento acceso_denegado con quién, qué ruta y qué rol hacía falta', async () => {
      const cookie = await ingresar(ctx.app, 'lector');
      const respuesta = await http()
        .get('/prueba/administracion')
        .set('Cookie', cookie)
        .expect(403);
      expect(respuesta.body.message).toBe('No tiene permiso para esta acción');

      const denegados = await eventos(ctx.pool, 'acceso_denegado');
      expect(denegados).toHaveLength(1);
      expect(denegados[0].usuario_id).not.toBeNull();
      expect(denegados[0].detalle).toBe(
        'GET /prueba/administracion; requiere administrador; tiene consulta',
      );
    });

    it('los accesos permitidos no generan eventos acceso_denegado', async () => {
      const cookie = await ingresar(ctx.app, 'admin');
      await http().get('/prueba/administracion').set('Cookie', cookie).expect(200);
      expect(await eventos(ctx.pool, 'acceso_denegado')).toHaveLength(0);
    });

    it('sin sesión una ruta con roles responde 401, no 403', async () => {
      await http().get('/prueba/administracion').expect(401);
    });

    it('si la auditoría falla, el acceso sigue denegado', async () => {
      const cookie = await ingresar(ctx.app, 'lector');
      // Con la tabla bloqueada por un renombre, el insert de auditoría falla.
      await ctx.pool.query('alter table auditoria rename to auditoria_tmp');
      try {
        await http().get('/prueba/administracion').set('Cookie', cookie).expect(403);
      } finally {
        await ctx.pool.query('alter table auditoria_tmp rename to auditoria');
      }
    });
  });

  it('la cookie lleva Secure solo en producción (se verifica con la respuesta de ingreso)', async () => {
    const respuesta = await http()
      .post('/auth/login')
      .send({ usuario: 'admin', clave: CLAVE_DE_PRUEBA })
      .expect(200);
    // NODE_ENV=test en las pruebas: sin Secure. En producción lo exige la prueba unitaria de opcionesCookie.
    expect(cookieDe(respuesta)).toMatch(/^faro_sesion=/);
    expect((respuesta.headers['set-cookie'] as unknown as string[])[0]).not.toMatch(/Secure/);
  });
});
