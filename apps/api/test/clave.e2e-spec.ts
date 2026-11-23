/**
 * #51 (ADR-011): cambio de clave propio (POST /auth/clave), restablecimiento por el administrador
 * (POST /usuarios/:id/clave) y la restricción de quien tiene una clave temporal, contra la API completa y PostgreSQL.
 */
import request from 'supertest';
import { LIMITE_POR_USUARIO } from '../src/auth/limite-ingreso.js';
import { sembrarCcdDemo } from '../src/semilla/ccd-demo.js';
import {
  CLAVE_DE_PRUEBA,
  crearApp,
  crearUsuario,
  eventos,
  ingresar,
  limpiarTablas,
  type AppDePrueba,
} from './ayudas.js';
import { generarPdf } from './pdfs.js';

const CLAVE_NUEVA = 'clave-nueva-larga-456';
const CLAVE_TEMPORAL = 'temporal-larga-789';
const CLAVE_ERRONEA = 'zorro-violeta-4821';

describe('Cambio y restablecimiento de clave (contra PostgreSQL real)', () => {
  let ctx: AppDePrueba;
  let idAdmin: number;
  let idEditor: number;
  let idLector: number;

  beforeAll(async () => {
    ctx = await crearApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await limpiarTablas(ctx.pool);
    idAdmin = await crearUsuario(ctx.db, { usuario: 'admin', rol: 'administrador' });
    idEditor = await crearUsuario(ctx.db, { usuario: 'editor', rol: 'editor' });
    idLector = await crearUsuario(ctx.db, { usuario: 'lector', rol: 'consulta' });
  });

  const http = () => request(ctx.app.getHttpServer());
  const cambiarClave = (cookie: string, cuerpo?: Record<string, unknown>) =>
    http().post('/auth/clave').set('Cookie', cookie).send(cuerpo);
  const restablecer = (id: number | string, cookie: string, cuerpo?: Record<string, unknown>) =>
    http().post(`/usuarios/${id}/clave`).set('Cookie', cookie).send(cuerpo);
  const filaDe = async (usuario: string) =>
    (await ctx.pool.query('select * from usuarios where usuario = $1', [usuario])).rows[0] as {
      id: number;
      clave_hash: string;
      debe_cambiar_clave: boolean;
      activo: boolean;
      rol: string;
    };
  const contar = async (consulta: string, parametros: unknown[] = []): Promise<number> =>
    (await ctx.pool.query(`select count(*)::int as n from ${consulta}`, parametros)).rows[0].n as number;
  /** Todo lo que hay en la auditoría, como texto: sirve para comprobar que no se filtra ninguna clave. */
  const textoDeAuditoria = async (): Promise<string> =>
    JSON.stringify((await ctx.pool.query('select * from auditoria order by id')).rows);
  const puedeIngresar = async (usuario: string, clave: string): Promise<boolean> =>
    (await http().post('/auth/login').send({ usuario, clave })).status === 200;

  describe('GET /auth/yo y el ingreso informan si hay que cambiar la clave', () => {
    it('una cuenta normal trae debeCambiarClave: false, en el ingreso y en /auth/yo', async () => {
      const ingreso = await http().post('/auth/login').send({ usuario: 'editor', clave: CLAVE_DE_PRUEBA }).expect(200);
      expect(ingreso.body.usuario).toMatchObject({ usuario: 'editor', rol: 'editor', debeCambiarClave: false });
      const cookie = await ingresar(ctx.app, 'editor');
      const yo = await http().get('/auth/yo').set('Cookie', cookie).expect(200);
      expect(yo.body.usuario).toMatchObject({ usuario: 'editor', debeCambiarClave: false });
      expect(JSON.stringify(yo.body)).not.toMatch(/hash|argon2/i);
    });
  });

  describe('POST /auth/clave: cambio de clave propio', () => {
    it.each([
      ['administrador', 'admin'],
      ['editor', 'editor'],
      ['consulta', 'lector'],
    ] as const)('el rol %s cambia su clave: la vieja deja de servir, la nueva sirve y la sesión sigue', async (_rol, usuario) => {
      const cookie = await ingresar(ctx.app, usuario);
      const respuesta = await cambiarClave(cookie, { claveActual: CLAVE_DE_PRUEBA, claveNueva: CLAVE_NUEVA }).expect(204);
      expect(respuesta.text).toBe('');
      expect(respuesta.headers['set-cookie']).toBeUndefined();

      await http().get('/auth/yo').set('Cookie', cookie).expect(200);
      expect(await puedeIngresar(usuario, CLAVE_DE_PRUEBA)).toBe(false);
      expect(await puedeIngresar(usuario, CLAVE_NUEVA)).toBe(true);

      const fila = await filaDe(usuario);
      expect(fila.clave_hash).toMatch(/^\$argon2id\$/);
      expect(fila.clave_hash).not.toContain(CLAVE_NUEVA);
      expect(fila.debe_cambiar_clave).toBe(false);
    });

    it('cierra las demás sesiones de la persona, deja la actual y no toca las de otros', async () => {
      const actual = await ingresar(ctx.app, 'editor');
      const otra1 = await ingresar(ctx.app, 'editor');
      const otra2 = await ingresar(ctx.app, 'editor');
      const ajena = await ingresar(ctx.app, 'lector');
      expect(await contar('sesiones where usuario_id = $1', [idEditor])).toBe(3);

      await cambiarClave(actual, { claveActual: CLAVE_DE_PRUEBA, claveNueva: CLAVE_NUEVA }).expect(204);

      await http().get('/auth/yo').set('Cookie', otra1).expect(401);
      await http().get('/auth/yo').set('Cookie', otra2).expect(401);
      await http().get('/auth/yo').set('Cookie', actual).expect(200);
      await http().get('/auth/yo').set('Cookie', ajena).expect(200);
      expect(await contar('sesiones where usuario_id = $1', [idEditor])).toBe(1);
      expect(await contar('sesiones where usuario_id = $1', [idLector])).toBe(1);
    });

    it('queda en la auditoría con quién y cuántas sesiones se cerraron, sin claves ni hashes', async () => {
      const actual = await ingresar(ctx.app, 'editor');
      await ingresar(ctx.app, 'editor');
      await cambiarClave(actual, { claveActual: CLAVE_DE_PRUEBA, claveNueva: CLAVE_NUEVA }).expect(204);

      expect(await eventos(ctx.pool, 'clave_cambiada')).toEqual([
        { usuario_id: idEditor, accion: 'clave_cambiada', detalle: 'otras sesiones cerradas: 1' },
      ]);
      const texto = await textoDeAuditoria();
      for (const secreto of [CLAVE_DE_PRUEBA, CLAVE_NUEVA, 'argon2', (await filaDe('editor')).clave_hash]) {
        expect(texto).not.toContain(secreto);
      }
    });

    describe('clave actual incorrecta', () => {
      it('responde 400 clave_actual_incorrecta (nunca 401: la interfaz lo tomaría por sesión vencida) y no cambia nada', async () => {
        const cookie = await ingresar(ctx.app, 'editor');
        const otra = await ingresar(ctx.app, 'editor');
        const antes = await filaDe('editor');

        const respuesta = await cambiarClave(cookie, { claveActual: CLAVE_ERRONEA, claveNueva: CLAVE_NUEVA }).expect(400);
        expect(respuesta.body).toMatchObject({ statusCode: 400, codigo: 'clave_actual_incorrecta' });
        expect(JSON.stringify(respuesta.body)).not.toContain(CLAVE_ERRONEA);
        expect(JSON.stringify(respuesta.body)).not.toContain(CLAVE_NUEVA);

        expect((await filaDe('editor')).clave_hash).toBe(antes.clave_hash);
        await http().get('/auth/yo').set('Cookie', cookie).expect(200);
        await http().get('/auth/yo').set('Cookie', otra).expect(200);
        expect(await eventos(ctx.pool, 'clave_cambiada')).toHaveLength(0);
      });

      it('cuenta en el límite de intentos y deja un ingreso_fallido que no repite lo escrito', async () => {
        const cookie = await ingresar(ctx.app, 'editor');
        await cambiarClave(cookie, { claveActual: CLAVE_ERRONEA, claveNueva: CLAVE_NUEVA }).expect(400);
        expect(await contar("intentos_ingreso where usuario = 'editor'")).toBe(1);
        expect(await eventos(ctx.pool, 'ingreso_fallido')).toEqual([
          { usuario_id: idEditor, accion: 'ingreso_fallido', detalle: 'cambio de clave: clave actual incorrecta' },
        ]);
        const texto = await textoDeAuditoria();
        expect(texto).not.toContain(CLAVE_ERRONEA);
        expect(texto).not.toContain(CLAVE_NUEVA);
      });

      it(`tras ${LIMITE_POR_USUARIO} fallos el siguiente intento recibe 429 con Retry-After, aunque la clave actual sea la correcta, y no cambia nada`, async () => {
        const cookie = await ingresar(ctx.app, 'editor');
        const antes = await filaDe('editor');
        for (let i = 0; i < LIMITE_POR_USUARIO; i++) {
          await cambiarClave(cookie, { claveActual: CLAVE_ERRONEA, claveNueva: CLAVE_NUEVA }).expect(400);
        }
        const bloqueado = await cambiarClave(cookie, { claveActual: CLAVE_DE_PRUEBA, claveNueva: CLAVE_NUEVA });
        expect(bloqueado.status).toBe(429);
        expect(bloqueado.body).toMatchObject({ statusCode: 429, codigo: 'demasiados_intentos' });
        expect(bloqueado.body.message).toMatch(/cambio de clave.*Intenta de nuevo en \d+ minutos?/);
        const espera = Number(bloqueado.headers['retry-after']);
        expect(espera).toBeGreaterThan(0);
        expect(espera).toBeLessThanOrEqual(15 * 60);

        expect((await filaDe('editor')).clave_hash).toBe(antes.clave_hash);
        // El bloqueo es el mismo del ingreso: tampoco deja ingresar con la clave correcta, y la sesión abierta sigue.
        await http().post('/auth/login').send({ usuario: 'editor', clave: CLAVE_DE_PRUEBA }).expect(429);
        await http().get('/auth/yo').set('Cookie', cookie).expect(200);
        // Se audita el paso al bloqueo una sola vez; insistir no llena la auditoría.
        await cambiarClave(cookie, { claveActual: CLAVE_ERRONEA, claveNueva: CLAVE_NUEVA }).expect(429);
        expect(await eventos(ctx.pool, 'ingreso_bloqueado')).toHaveLength(1);
        expect(await eventos(ctx.pool, 'ingreso_fallido')).toHaveLength(LIMITE_POR_USUARIO);
        expect(await contar("intentos_ingreso where usuario = 'editor'")).toBe(LIMITE_POR_USUARIO);
      });

      it('los fallos de ingreso y los de cambio de clave se suman en el mismo límite', async () => {
        const cookie = await ingresar(ctx.app, 'editor');
        for (let i = 0; i < 3; i++) {
          await http().post('/auth/login').send({ usuario: 'editor', clave: CLAVE_ERRONEA }).expect(401);
        }
        for (let i = 0; i < LIMITE_POR_USUARIO - 3; i++) {
          await cambiarClave(cookie, { claveActual: CLAVE_ERRONEA, claveNueva: CLAVE_NUEVA }).expect(400);
        }
        await cambiarClave(cookie, { claveActual: CLAVE_DE_PRUEBA, claveNueva: CLAVE_NUEVA }).expect(429);
      });

      it('bloquear a una persona no afecta a otra', async () => {
        const cookie = await ingresar(ctx.app, 'editor');
        const cookieLector = await ingresar(ctx.app, 'lector');
        for (let i = 0; i < LIMITE_POR_USUARIO; i++) {
          await cambiarClave(cookie, { claveActual: CLAVE_ERRONEA, claveNueva: CLAVE_NUEVA }).expect(400);
        }
        await cambiarClave(cookieLector, { claveActual: CLAVE_DE_PRUEBA, claveNueva: CLAVE_NUEVA }).expect(204);
      });

      it('un cambio correcto reinicia la cuenta de intentos de la persona', async () => {
        const cookie = await ingresar(ctx.app, 'editor');
        for (let i = 0; i < 2; i++) {
          await cambiarClave(cookie, { claveActual: CLAVE_ERRONEA, claveNueva: CLAVE_NUEVA }).expect(400);
        }
        expect(await contar("intentos_ingreso where usuario = 'editor'")).toBe(2);
        await cambiarClave(cookie, { claveActual: CLAVE_DE_PRUEBA, claveNueva: CLAVE_NUEVA }).expect(204);
        expect(await contar("intentos_ingreso where usuario = 'editor'")).toBe(0);
      });
    });

    describe('datos inválidos: 400, no cambia nada y no cuenta como intento', () => {
      it.each([
        ['sin cuerpo', undefined],
        ['cuerpo vacío', {}],
        ['sin clave actual', { claveNueva: CLAVE_NUEVA }],
        ['sin clave nueva', { claveActual: CLAVE_DE_PRUEBA }],
        ['clave actual vacía', { claveActual: '', claveNueva: CLAVE_NUEVA }],
        ['clave actual de más de 256 caracteres', { claveActual: 'x'.repeat(257), claveNueva: CLAVE_NUEVA }],
        ['clave nueva corta (11 caracteres)', { claveActual: CLAVE_DE_PRUEBA, claveNueva: 'corta-12345' }],
        ['clave nueva de más de 256 caracteres', { claveActual: CLAVE_DE_PRUEBA, claveNueva: 'x'.repeat(257) }],
        ['clave nueva de solo espacios', { claveActual: CLAVE_DE_PRUEBA, claveNueva: ' '.repeat(20) }],
        ['claves que no son texto', { claveActual: 123, claveNueva: 456789012345 }],
        ['clave nueva igual a la actual', { claveActual: CLAVE_DE_PRUEBA, claveNueva: CLAVE_DE_PRUEBA }],
        ['un campo que no existe', { claveActual: CLAVE_DE_PRUEBA, claveNueva: CLAVE_NUEVA, rol: 'administrador' }],
      ])('%s', async (_caso, cuerpo) => {
        const cookie = await ingresar(ctx.app, 'editor');
        const antes = await filaDe('editor');
        const respuesta = await http().post('/auth/clave').set('Cookie', cookie).send(cuerpo as object);
        expect(respuesta.status).toBe(400);
        expect(Array.isArray(respuesta.body.problemas)).toBe(true);
        expect(respuesta.body.codigo).toBeUndefined(); // no es una clave actual incorrecta
        expect(JSON.stringify(respuesta.body)).not.toContain(CLAVE_DE_PRUEBA);
        expect(JSON.stringify(respuesta.body)).not.toContain(CLAVE_NUEVA);
        expect((await filaDe('editor')).clave_hash).toBe(antes.clave_hash);
        expect(await contar('intentos_ingreso')).toBe(0);
        await http().get('/auth/yo').set('Cookie', cookie).expect(200);
      });

      it('la clave nueva igual a la actual dice que debe ser distinta, sin delatar si la actual es correcta', async () => {
        const cookie = await ingresar(ctx.app, 'editor');
        const correcta = await cambiarClave(cookie, { claveActual: CLAVE_DE_PRUEBA, claveNueva: CLAVE_DE_PRUEBA }).expect(400);
        const incorrecta = await cambiarClave(cookie, { claveActual: CLAVE_ERRONEA + '-1', claveNueva: CLAVE_ERRONEA + '-1' }).expect(400);
        expect(correcta.body.problemas).toEqual(['claveNueva: debe ser distinta de la clave actual']);
        expect(incorrecta.body.problemas).toEqual(correcta.body.problemas);
      });
    });

    it('sin sesión responde 401', async () => {
      await http().post('/auth/clave').send({ claveActual: CLAVE_DE_PRUEBA, claveNueva: CLAVE_NUEVA }).expect(401);
      expect(await puedeIngresar('editor', CLAVE_DE_PRUEBA)).toBe(true);
    });

    it('con una cookie inventada responde 401 y no cuenta como intento de nadie', async () => {
      await cambiarClave(`faro_sesion=${'a'.repeat(64)}`, { claveActual: CLAVE_DE_PRUEBA, claveNueva: CLAVE_NUEVA }).expect(401);
      expect(await contar('intentos_ingreso')).toBe(0);
    });

    it('desde otro sitio (Origin ajeno) se rechaza con 403 origen_no_permitido antes de tocar nada', async () => {
      const cookie = await ingresar(ctx.app, 'editor');
      const antes = await filaDe('editor');
      const respuesta = await http()
        .post('/auth/clave')
        .set('Cookie', cookie)
        .set('Origin', 'https://malo.example')
        .send({ claveActual: CLAVE_DE_PRUEBA, claveNueva: CLAVE_NUEVA });
      expect(respuesta.status).toBe(403);
      expect(respuesta.body).toMatchObject({ codigo: 'origen_no_permitido' });
      expect((await filaDe('editor')).clave_hash).toBe(antes.clave_hash);
      expect(await contar('intentos_ingreso')).toBe(0);
      expect(await contar("auditoria where accion = 'clave_cambiada'")).toBe(0);
    });

    it('dos cambios simultáneos con la misma clave actual: solo uno se aplica y la clave que queda es la suya', async () => {
      for (let vuelta = 0; vuelta < 3; vuelta++) {
        await limpiarTablas(ctx.pool);
        await crearUsuario(ctx.db, { usuario: 'admin', rol: 'administrador' });
        await crearUsuario(ctx.db, { usuario: 'editor', rol: 'editor' });
        const a = await ingresar(ctx.app, 'editor');
        const b = await ingresar(ctx.app, 'editor');
        const [ra, rb] = await Promise.all([
          cambiarClave(a, { claveActual: CLAVE_DE_PRUEBA, claveNueva: 'clave-de-la-sesion-a-1' }),
          cambiarClave(b, { claveActual: CLAVE_DE_PRUEBA, claveNueva: 'clave-de-la-sesion-b-2' }),
        ]);
        const estados = [ra.status, rb.status].sort((x, y) => x - y);
        // El perdedor puede haber verificado la clave vieja antes (409) o después (400) de que el otro escribiera.
        expect(estados[0], `vuelta ${vuelta}`).toBe(204);
        expect([400, 409], `vuelta ${vuelta}`).toContain(estados[1]);
        const ganadora = ra.status === 204 ? 'clave-de-la-sesion-a-1' : 'clave-de-la-sesion-b-2';
        const perdedora = ra.status === 204 ? 'clave-de-la-sesion-b-2' : 'clave-de-la-sesion-a-1';
        expect(await puedeIngresar('editor', ganadora), `vuelta ${vuelta}`).toBe(true);
        expect(await puedeIngresar('editor', perdedora), `vuelta ${vuelta}`).toBe(false);
        expect(await eventos(ctx.pool, 'clave_cambiada'), `vuelta ${vuelta}`).toHaveLength(1);
      }
    });
  });

  describe('POST /usuarios/:id/clave: restablecimiento por el administrador', () => {
    it('fija una clave temporal: la anterior deja de servir, sus sesiones se cierran y debe cambiarla', async () => {
      const cookieAdmin = await ingresar(ctx.app, 'admin');
      const sesion1 = await ingresar(ctx.app, 'editor');
      const sesion2 = await ingresar(ctx.app, 'editor');
      const antes = await filaDe('editor');

      const respuesta = await restablecer(idEditor, cookieAdmin, { clave: CLAVE_TEMPORAL }).expect(204);
      expect(respuesta.text).toBe('');
      expect(respuesta.body).toEqual({});

      await http().get('/auth/yo').set('Cookie', sesion1).expect(401);
      await http().get('/auth/yo').set('Cookie', sesion2).expect(401);
      expect(await contar('sesiones where usuario_id = $1', [idEditor])).toBe(0);
      // La sesión del administrador que lo hizo no se toca.
      await http().get('/usuarios').set('Cookie', cookieAdmin).expect(200);

      const fila = await filaDe('editor');
      expect(fila.debe_cambiar_clave).toBe(true);
      expect(fila.clave_hash).toMatch(/^\$argon2id\$/);
      expect(fila.clave_hash).not.toBe(antes.clave_hash);
      expect(fila.clave_hash).not.toContain(CLAVE_TEMPORAL);

      expect(await puedeIngresar('editor', CLAVE_DE_PRUEBA)).toBe(false);
      const ingreso = await http().post('/auth/login').send({ usuario: 'editor', clave: CLAVE_TEMPORAL }).expect(200);
      expect(ingreso.body.usuario).toMatchObject({ usuario: 'editor', debeCambiarClave: true });
    });

    it('queda en la auditoría con quién lo hizo, a quién y cuántas sesiones se cerraron, sin la clave', async () => {
      const cookieAdmin = await ingresar(ctx.app, 'admin');
      await ingresar(ctx.app, 'editor');
      await ingresar(ctx.app, 'editor');
      await restablecer(idEditor, cookieAdmin, { clave: CLAVE_TEMPORAL }).expect(204);

      expect(await eventos(ctx.pool, 'clave_restablecida')).toEqual([
        {
          usuario_id: idAdmin,
          accion: 'clave_restablecida',
          detalle: `usuario ${idEditor} (editor); sesiones cerradas: 2`,
        },
      ]);
      const texto = await textoDeAuditoria();
      expect(texto).not.toContain(CLAVE_TEMPORAL);
      expect(texto).not.toContain('argon2');
    });

    it('un administrador puede restablecer la clave de otro administrador', async () => {
      await crearUsuario(ctx.db, { usuario: 'otro.admin', rol: 'administrador' });
      const cookieAdmin = await ingresar(ctx.app, 'admin');
      const otraSesion = await ingresar(ctx.app, 'otro.admin');
      await restablecer((await filaDe('otro.admin')).id, cookieAdmin, { clave: CLAVE_TEMPORAL }).expect(204);
      await http().get('/auth/yo').set('Cookie', otraSesion).expect(401);
      expect((await filaDe('otro.admin')).debe_cambiar_clave).toBe(true);
    });

    it('un usuario inactivo también se puede restablecer: no tiene sesiones y al reactivarlo ingresa con la temporal', async () => {
      await crearUsuario(ctx.db, { usuario: 'baja', rol: 'editor', activo: false });
      const cookieAdmin = await ingresar(ctx.app, 'admin');
      const id = (await filaDe('baja')).id;
      await restablecer(id, cookieAdmin, { clave: CLAVE_TEMPORAL }).expect(204);
      expect(await puedeIngresar('baja', CLAVE_TEMPORAL)).toBe(false); // sigue inactivo
      await http().patch(`/usuarios/${id}`).set('Cookie', cookieAdmin).send({ activo: true }).expect(200);
      expect(await puedeIngresar('baja', CLAVE_TEMPORAL)).toBe(true);
      expect((await filaDe('baja')).debe_cambiar_clave).toBe(true);
    });

    it('restablecer otra vez pisa la temporal anterior', async () => {
      const cookieAdmin = await ingresar(ctx.app, 'admin');
      await restablecer(idEditor, cookieAdmin, { clave: CLAVE_TEMPORAL }).expect(204);
      await restablecer(idEditor, cookieAdmin, { clave: 'segunda-temporal-321' }).expect(204);
      expect(await puedeIngresar('editor', CLAVE_TEMPORAL)).toBe(false);
      expect(await puedeIngresar('editor', 'segunda-temporal-321')).toBe(true);
    });

    describe('quién puede', () => {
      it('el editor y el de consulta reciben 403, no cambian nada y queda acceso_denegado', async () => {
        const sesionLector = await ingresar(ctx.app, 'lector');
        const antes = await filaDe('lector');
        for (const quien of ['editor', 'lector']) {
          const cookie = await ingresar(ctx.app, quien);
          await restablecer(idLector, cookie, { clave: CLAVE_TEMPORAL }).expect(403);
        }
        const despues = await filaDe('lector');
        expect(despues.clave_hash).toBe(antes.clave_hash);
        expect(despues.debe_cambiar_clave).toBe(false);
        await http().get('/auth/yo').set('Cookie', sesionLector).expect(200);
        expect(await eventos(ctx.pool, 'clave_restablecida')).toHaveLength(0);
        expect(await eventos(ctx.pool, 'acceso_denegado')).toHaveLength(2);
      });

      it('sin sesión, 401', async () => {
        await http().post(`/usuarios/${idEditor}/clave`).send({ clave: CLAVE_TEMPORAL }).expect(401);
        expect(await puedeIngresar('editor', CLAVE_DE_PRUEBA)).toBe(true);
      });

      it('desde otro sitio (Origin ajeno), 403 origen_no_permitido y no cambia nada', async () => {
        const cookieAdmin = await ingresar(ctx.app, 'admin');
        const antes = await filaDe('editor');
        const respuesta = await http()
          .post(`/usuarios/${idEditor}/clave`)
          .set('Cookie', cookieAdmin)
          .set('Origin', 'https://malo.example')
          .send({ clave: CLAVE_TEMPORAL });
        expect(respuesta.status).toBe(403);
        expect(respuesta.body).toMatchObject({ codigo: 'origen_no_permitido' });
        expect((await filaDe('editor')).clave_hash).toBe(antes.clave_hash);
        expect(await eventos(ctx.pool, 'clave_restablecida')).toHaveLength(0);
      });
    });

    it('un administrador no restablece su propia clave por esta ruta: 409 y todo queda igual', async () => {
      const cookieAdmin = await ingresar(ctx.app, 'admin');
      const antes = await filaDe('admin');
      const respuesta = await restablecer(idAdmin, cookieAdmin, { clave: CLAVE_TEMPORAL }).expect(409);
      expect(respuesta.body).toMatchObject({ codigo: 'restablecer_clave_propia' });
      const despues = await filaDe('admin');
      expect(despues.clave_hash).toBe(antes.clave_hash);
      expect(despues.debe_cambiar_clave).toBe(false);
      await http().get('/usuarios').set('Cookie', cookieAdmin).expect(200);
      expect(await eventos(ctx.pool, 'clave_restablecida')).toHaveLength(0);
    });

    it('un usuario que no existe: 404; un identificador mal escrito: 400', async () => {
      const cookieAdmin = await ingresar(ctx.app, 'admin');
      await restablecer(9999, cookieAdmin, { clave: CLAVE_TEMPORAL }).expect(404);
      await restablecer('abc', cookieAdmin, { clave: CLAVE_TEMPORAL }).expect(400);
      await restablecer('0', cookieAdmin, { clave: CLAVE_TEMPORAL }).expect(400);
      expect(await eventos(ctx.pool, 'clave_restablecida')).toHaveLength(0);
    });

    describe('datos inválidos: 400 y no cambia nada', () => {
      it.each([
        ['sin cuerpo', undefined],
        ['sin clave', {}],
        ['clave corta (11 caracteres)', { clave: 'corta-12345' }],
        ['clave de más de 256 caracteres', { clave: 'x'.repeat(257) }],
        ['clave de solo espacios', { clave: ' '.repeat(20) }],
        ['clave que no es texto', { clave: 123456789012 }],
        ['un campo que no existe (claveActual)', { clave: CLAVE_TEMPORAL, claveActual: CLAVE_DE_PRUEBA }],
        ['un campo que no existe (debeCambiarClave)', { clave: CLAVE_TEMPORAL, debeCambiarClave: false }],
      ])('%s', async (_caso, cuerpo) => {
        const cookieAdmin = await ingresar(ctx.app, 'admin');
        const sesion = await ingresar(ctx.app, 'editor');
        const antes = await filaDe('editor');
        const respuesta = await http().post(`/usuarios/${idEditor}/clave`).set('Cookie', cookieAdmin).send(cuerpo as object);
        expect(respuesta.status).toBe(400);
        expect(JSON.stringify(respuesta.body)).not.toContain(CLAVE_TEMPORAL);
        const despues = await filaDe('editor');
        expect(despues.clave_hash).toBe(antes.clave_hash);
        expect(despues.debe_cambiar_clave).toBe(false);
        await http().get('/auth/yo').set('Cookie', sesion).expect(200);
      });
    });

    it('el listado y las demás respuestas de usuarios no cambian de forma ni muestran la marca', async () => {
      const cookieAdmin = await ingresar(ctx.app, 'admin');
      await restablecer(idEditor, cookieAdmin, { clave: CLAVE_TEMPORAL }).expect(204);
      const { body } = await http().get('/usuarios').set('Cookie', cookieAdmin).expect(200);
      expect(Object.keys((body as object[])[0]).sort()).toEqual(['activo', 'creadoEn', 'id', 'nombre', 'rol', 'usuario']);
    });
  });

  describe('clave temporal: solo ver quién es, cerrar sesión y cambiar la clave', () => {
    /** Restablece la clave de `usuario` y devuelve la cookie de una sesión abierta con la clave temporal. */
    async function conClaveTemporal(usuario: string): Promise<string> {
      const cookieAdmin = await ingresar(ctx.app, 'admin');
      await restablecer((await filaDe(usuario)).id, cookieAdmin, { clave: CLAVE_TEMPORAL }).expect(204);
      return ingresar(ctx.app, usuario, CLAVE_TEMPORAL);
    }

    it('lo que sí puede: /auth/yo (con debeCambiarClave: true), /auth/logout y /auth/clave', async () => {
      const cookie = await conClaveTemporal('editor');
      const yo = await http().get('/auth/yo').set('Cookie', cookie).expect(200);
      expect(yo.body.usuario).toMatchObject({ usuario: 'editor', rol: 'editor', debeCambiarClave: true });

      const otra = await ingresar(ctx.app, 'editor', CLAVE_TEMPORAL);
      await http().post('/auth/logout').set('Cookie', otra).expect(204);
      await http().get('/auth/yo').set('Cookie', otra).expect(401);

      await cambiarClave(cookie, { claveActual: CLAVE_TEMPORAL, claveNueva: CLAVE_NUEVA }).expect(204);
    });

    it.each([
      ['GET', '/documentos'],
      ['GET', '/documentos/1'],
      ['GET', '/documentos/1/versiones'],
      ['GET', '/series'],
      ['POST', '/documentos'],
      ['POST', '/documentos/1/versiones'],
      ['POST', '/documentos/1/versiones/1/restaurar'],
      ['GET', '/documentos/1/versiones/1/archivo'],
    ] as const)('lo que no puede: %s %s responde 403 cambio_de_clave_requerido', async (metodo, ruta) => {
      const cookie = await conClaveTemporal('editor');
      const respuesta = await (metodo === 'GET' ? http().get(ruta) : http().post(ruta)).set('Cookie', cookie);
      expect(respuesta.status).toBe(403);
      expect(respuesta.body).toMatchObject({ statusCode: 403, codigo: 'cambio_de_clave_requerido' });
    });

    it('la restricción va antes que los roles: un administrador con clave temporal tampoco administra ni audita', async () => {
      await crearUsuario(ctx.db, { usuario: 'otro.admin', rol: 'administrador' });
      const cookieAdmin = await ingresar(ctx.app, 'admin');
      await restablecer((await filaDe('otro.admin')).id, cookieAdmin, { clave: CLAVE_TEMPORAL }).expect(204);
      const temporal = await ingresar(ctx.app, 'otro.admin', CLAVE_TEMPORAL);

      for (const [metodo, ruta] of [
        ['GET', '/usuarios'],
        ['GET', '/auditoria'],
        ['POST', '/usuarios'],
        ['PATCH', `/usuarios/${idEditor}`],
        ['POST', `/usuarios/${idEditor}/clave`],
      ] as const) {
        const peticion = http()[metodo.toLowerCase() as 'get' | 'post' | 'patch'](ruta).set('Cookie', temporal);
        const respuesta = await (metodo === 'GET' ? peticion : peticion.send({}));
        expect(respuesta.status, `${metodo} ${ruta}`).toBe(403);
        expect(respuesta.body, `${metodo} ${ruta}`).toMatchObject({ codigo: 'cambio_de_clave_requerido' });
      }
      // Y nada de eso tuvo efecto.
      expect((await filaDe('editor')).debe_cambiar_clave).toBe(false);
    });

    it('cada denegación queda en la auditoría como acceso_denegado, con el motivo y sin lo enviado', async () => {
      const cookie = await conClaveTemporal('editor');
      await http().get('/documentos').query({ q: 'texto-secreto' }).set('Cookie', cookie).expect(403);
      await http().get('/series').set('Cookie', cookie).expect(403);
      const denegados = await eventos(ctx.pool, 'acceso_denegado');
      expect(denegados).toEqual([
        { usuario_id: idEditor, accion: 'acceso_denegado', detalle: 'GET /documentos; cambio de clave requerido' },
        { usuario_id: idEditor, accion: 'acceso_denegado', detalle: 'GET /series; cambio de clave requerido' },
      ]);
    });

    it('con una clave actual incorrecta no queda bloqueada de otra forma: 400 y sigue restringida', async () => {
      const cookie = await conClaveTemporal('editor');
      const respuesta = await cambiarClave(cookie, { claveActual: CLAVE_ERRONEA, claveNueva: CLAVE_NUEVA }).expect(400);
      expect(respuesta.body).toMatchObject({ codigo: 'clave_actual_incorrecta' });
      await http().get('/auth/yo').set('Cookie', cookie).expect(200);
      await http().get('/documentos').set('Cookie', cookie).expect(403);
    });

    it('la clave temporal no sirve como clave nueva: debe elegir otra', async () => {
      const cookie = await conClaveTemporal('editor');
      await cambiarClave(cookie, { claveActual: CLAVE_TEMPORAL, claveNueva: CLAVE_TEMPORAL }).expect(400);
      expect((await filaDe('editor')).debe_cambiar_clave).toBe(true);
    });

    it('al cambiar la clave todo vuelve a funcionar, incluso cargar un documento, y la temporal deja de servir', async () => {
      await sembrarCcdDemo(ctx.db);
      const { rows } = await ctx.pool.query(`select id from series_ccd where codigo = '100.1'`);
      const cookie = await conClaveTemporal('editor');
      const cargar = () =>
        http()
          .post('/documentos')
          .set('Cookie', cookie)
          .field('titulo', 'Documento')
          .field('expediente', 'EXP-1')
          .field('serieId', String(rows[0].id))
          .field('fechaDocumento', '2026-03-02')
          .attach('archivo', generarPdf(['clave temporal']), { filename: 'd.pdf', contentType: 'application/pdf' });

      await cargar().expect(403);
      await http().get('/documentos').set('Cookie', cookie).expect(403);

      await cambiarClave(cookie, { claveActual: CLAVE_TEMPORAL, claveNueva: CLAVE_NUEVA }).expect(204);

      expect((await filaDe('editor')).debe_cambiar_clave).toBe(false);
      const yo = await http().get('/auth/yo').set('Cookie', cookie).expect(200);
      expect(yo.body.usuario).toMatchObject({ debeCambiarClave: false });
      await http().get('/documentos').set('Cookie', cookie).expect(200);
      await http().get('/series').set('Cookie', cookie).expect(200);
      await cargar().expect(201);
      expect(await puedeIngresar('editor', CLAVE_TEMPORAL)).toBe(false);
      expect(await puedeIngresar('editor', CLAVE_NUEVA)).toBe(true);
      const otroIngreso = await http().post('/auth/login').send({ usuario: 'editor', clave: CLAVE_NUEVA }).expect(200);
      expect(otroIngreso.body.usuario.debeCambiarClave).toBe(false);
    });

    it('si el administrador restablece mientras la persona tiene una sesión con la temporal, esa sesión también muere', async () => {
      const cookieAdmin = await ingresar(ctx.app, 'admin');
      const cookie = await conClaveTemporal('editor');
      await restablecer(idEditor, cookieAdmin, { clave: 'segunda-temporal-321' }).expect(204);
      await http().get('/auth/yo').set('Cookie', cookie).expect(401);
    });

    it('desactivar y cambiar el rol siguen funcionando con una cuenta con clave temporal', async () => {
      const cookieAdmin = await ingresar(ctx.app, 'admin');
      const cookie = await conClaveTemporal('editor');
      await http().patch(`/usuarios/${idEditor}`).set('Cookie', cookieAdmin).send({ rol: 'consulta' }).expect(200);
      // El rol rige al instante y la marca sigue: la cuenta no se «libera» por cambiarle el rol.
      const yo = await http().get('/auth/yo').set('Cookie', cookie).expect(200);
      expect(yo.body.usuario).toMatchObject({ rol: 'consulta', debeCambiarClave: true });
      await http().patch(`/usuarios/${idEditor}`).set('Cookie', cookieAdmin).send({ activo: false }).expect(200);
      await http().get('/auth/yo').set('Cookie', cookie).expect(401);
      expect(await puedeIngresar('editor', CLAVE_TEMPORAL)).toBe(false);
    });

    it('PATCH /usuarios/:id sigue sin aceptar una clave (no es otra vía para restablecerla)', async () => {
      const cookieAdmin = await ingresar(ctx.app, 'admin');
      await http().patch(`/usuarios/${idEditor}`).set('Cookie', cookieAdmin).send({ clave: CLAVE_TEMPORAL }).expect(400);
    });
  });

  describe('interbloqueos: el restablecimiento convive con los cambios de rol y de actividad', () => {
    it('restablecimientos y cambios simultáneos sobre los administradores nunca dan error 500', async () => {
      const idOtro = await crearUsuario(ctx.db, { usuario: 'admin.2', rol: 'administrador' });
      const idTercero = await crearUsuario(ctx.db, { usuario: 'admin.3', rol: 'administrador' });
      const permitidos = [200, 204, 401, 403, 409];
      const hashOriginal = (await filaDe('admin')).clave_hash;
      for (let vuelta = 0; vuelta < 6; vuelta++) {
        const cookies = [
          await ingresar(ctx.app, 'admin'),
          await ingresar(ctx.app, 'admin.2'),
          await ingresar(ctx.app, 'admin.3'),
        ];
        const ids = [idAdmin, idOtro, idTercero];
        const peticiones = ids.flatMap((id, i) => {
          const otro = ids[(i + 1) % ids.length];
          return [
            restablecer(otro, cookies[i], { clave: CLAVE_TEMPORAL }),
            http().patch(`/usuarios/${otro}`).set('Cookie', cookies[i]).send({ rol: 'editor' }),
            http().patch(`/usuarios/${idEditor}`).set('Cookie', cookies[i]).send({ activo: vuelta % 2 === 1 }),
            restablecer(idEditor, cookies[i], { clave: 'otra-temporal-654321' }),
          ];
        });
        const respuestas = await Promise.all(peticiones);
        expect(
          respuestas.map((r) => r.status).filter((s) => !permitidos.includes(s)),
          `vuelta ${vuelta}`,
        ).toEqual([]);
        // Sea cual sea el resultado, siempre queda alguien que administre.
        expect(await contar("usuarios where rol = 'administrador' and activo"), `vuelta ${vuelta}`).toBeGreaterThanOrEqual(1);
        // Se devuelve todo al punto de partida para la vuelta siguiente (los restablecimientos cambiaron las claves).
        await ctx.pool.query(
          `update usuarios set clave_hash = $1, debe_cambiar_clave = false, activo = true,
                               rol = case when usuario like 'admin%' then 'administrador'::rol_usuario else rol end`,
          [hashOriginal],
        );
      }
    }, 60_000);
  });
});
