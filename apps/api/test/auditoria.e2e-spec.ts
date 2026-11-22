import request from 'supertest';
import { crearApp, crearUsuario, eventos, ingresar, limpiarTablas, type AppDePrueba } from './ayudas.js';

interface Pagina {
  items: Array<{
    id: number;
    usuarioId: number | null;
    usuario: string | null;
    accion: string;
    documentoId: number | null;
    detalle: string | null;
    creadoEn: string;
  }>;
  total: number;
  pagina: number;
  tamano: number;
}

describe('Auditoría (contra PostgreSQL real)', () => {
  let ctx: AppDePrueba;
  let idAdmin: number;
  let idEditor: number;
  let cookieAdmin: string;

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
    await crearUsuario(ctx.db, { usuario: 'lector', rol: 'consulta' });
    cookieAdmin = await ingresar(ctx.app, 'admin');
  });

  const http = () => request(ctx.app.getHttpServer());
  const consultar = (consulta = '', cookie = cookieAdmin) =>
    http().get(`/auditoria${consulta}`).set('Cookie', cookie);

  /** Inserta eventos de prueba directamente, con fechas separadas un minuto. */
  async function sembrarEventos(n: number, base = '2026-11-10T10:00:00Z'): Promise<void> {
    await ctx.pool.query(
      `insert into auditoria (usuario_id, accion, detalle, creado_en)
       select $1, 'ingreso', 'evento ' || g, $2::timestamptz + (g || ' minutes')::interval
       from generate_series(1, $3) g`,
      [idEditor, base, n],
    );
  }

  describe('quién puede consultar', () => {
    it('el administrador ve los eventos, con el nombre de quien actuó', async () => {
      const respuesta = await consultar().expect(200);
      const cuerpo = respuesta.body as Pagina;
      expect(cuerpo.total).toBeGreaterThanOrEqual(1);
      const ingreso = cuerpo.items.find((e) => e.accion === 'ingreso');
      expect(ingreso).toMatchObject({ usuarioId: idAdmin, usuario: 'admin' });
    });

    it.each(['editor', 'lector'])('%s recibe 403 y el intento queda registrado', async (usuario) => {
      const cookie = await ingresar(ctx.app, usuario);
      await consultar('', cookie).expect(403);
      const denegados = await eventos(ctx.pool, 'acceso_denegado');
      expect(denegados).toHaveLength(1);
      expect(denegados[0].detalle).toBe(
        `GET /auditoria; requiere administrador; tiene ${usuario === 'editor' ? 'editor' : 'consulta'}`,
      );
    });

    it('sin sesión recibe 401', async () => {
      await http().get('/auditoria').expect(401);
    });
  });

  describe('los eventos no se pueden editar ni borrar', () => {
    it.each([
      ['POST', '/auditoria'],
      ['PUT', '/auditoria/1'],
      ['PATCH', '/auditoria/1'],
      ['DELETE', '/auditoria/1'],
      ['DELETE', '/auditoria'],
    ])('la API no tiene la ruta %s %s', async (metodo, ruta) => {
      const peticion = http()[metodo.toLowerCase() as 'post' | 'put' | 'patch' | 'delete'](ruta);
      await peticion.set('Cookie', cookieAdmin).send({}).expect(404);
    });

    it('la base rechaza un UPDATE sobre un evento', async () => {
      await sembrarEventos(1);
      await expect(
        ctx.pool.query(`update auditoria set detalle = 'alterado' where id = (select min(id) from auditoria)`),
      ).rejects.toThrow(/no admite UPDATE/);
    });

    it('la base rechaza un DELETE sobre un evento', async () => {
      await sembrarEventos(1);
      await expect(ctx.pool.query('delete from auditoria')).rejects.toThrow(/no admite DELETE/);
    });

    it('tras los intentos fallidos los eventos siguen intactos', async () => {
      await sembrarEventos(2);
      await ctx.pool.query(`update auditoria set detalle = 'x'`).catch(() => {});
      await ctx.pool.query('delete from auditoria').catch(() => {});
      const { rows } = await ctx.pool.query(
        `select count(*)::int as n from auditoria where detalle like 'evento %'`,
      );
      expect(rows[0].n).toBe(2);
    });

    it('insertar nuevos eventos sigue funcionando', async () => {
      await ingresar(ctx.app, 'editor');
      expect(await eventos(ctx.pool, 'ingreso')).toHaveLength(2);
    });
  });

  describe('filtros', () => {
    it('por usuario', async () => {
      await sembrarEventos(3);
      const { body } = await consultar(`?usuarioId=${idEditor}`).expect(200);
      expect((body as Pagina).total).toBe(3);
      expect((body as Pagina).items.every((e) => e.usuarioId === idEditor)).toBe(true);
    });

    it('por acción', async () => {
      await sembrarEventos(2);
      await ctx.pool.query(
        `insert into auditoria (usuario_id, accion) values ($1, 'acceso_denegado')`,
        [idEditor],
      );
      const { body } = await consultar('?accion=acceso_denegado').expect(200);
      expect((body as Pagina).total).toBe(1);
      expect((body as Pagina).items[0].accion).toBe('acceso_denegado');
    });

    it('por documento', async () => {
      const { rows: serie } = await ctx.pool.query(
        `insert into series_ccd (codigo, nombre) values ('100', 'Serie') returning id`,
      );
      const { rows: hija } = await ctx.pool.query(
        `insert into series_ccd (codigo, nombre, padre_id) values ('100.1', 'Subserie', $1) returning id`,
        [serie[0].id],
      );
      const { rows: doc } = await ctx.pool.query(
        `insert into documentos (titulo, expediente, serie_id, fecha_documento, creado_por)
         values ('Acta', 'EXP-1', $1, '2026-11-01', $2) returning id`,
        [hija[0].id, idEditor],
      );
      await ctx.pool.query(
        `insert into auditoria (usuario_id, accion, documento_id) values ($1, 'ingreso', $2)`,
        [idEditor, doc[0].id],
      );
      await sembrarEventos(2);
      const { body } = await consultar(`?documentoId=${doc[0].id}`).expect(200);
      expect((body as Pagina).total).toBe(1);
      expect((body as Pagina).items[0].documentoId).toBe(doc[0].id);
    });

    it('por rango de fechas, con los extremos incluidos', async () => {
      await sembrarEventos(10); // 10:01 a 10:10
      const { body } = await consultar(
        `?usuarioId=${idEditor}&desde=2026-11-10T10:03:00Z&hasta=2026-11-10T10:05:00Z`,
      ).expect(200);
      expect(
        (body as Pagina).items.map((e) => e.detalle ?? '').sort((a, b) => a.localeCompare(b)),
      ).toEqual([
        'evento 3',
        'evento 4',
        'evento 5',
      ]);
    });

    it('combinados', async () => {
      await sembrarEventos(5);
      const { body } = await consultar(
        `?usuarioId=${idEditor}&accion=ingreso&desde=2026-11-10T10:04:00Z`,
      ).expect(200);
      expect((body as Pagina).total).toBe(2);
    });

    it('sin resultados devuelve una lista vacía, no un error', async () => {
      const { body } = await consultar('?usuarioId=99999').expect(200);
      expect(body).toMatchObject({ items: [], total: 0 });
    });

    it.each([
      ['pagina=0'],
      ['tamano=101'],
      ['accion=inventada'],
      ['desde=ayer'],
      ['desde=2026-12-01&hasta=2026-11-01'],
      ['usuarioId=abc'],
    ])('responde 400 con %s y dice qué parámetro falló', async (consulta) => {
      const respuesta = await consultar(`?${consulta}`).expect(400);
      expect(respuesta.body.problemas).toEqual(expect.any(Array));
      expect(respuesta.body.problemas.length).toBeGreaterThan(0);
    });
  });

  describe('paginación', () => {
    it('devuelve los más recientes primero', async () => {
      await sembrarEventos(5);
      const { body } = await consultar(`?usuarioId=${idEditor}`).expect(200);
      const fechas = (body as Pagina).items.map((e) => e.creadoEn);
      expect(fechas).toEqual([...fechas].sort((a, b) => b.localeCompare(a)));
    });

    it('las páginas no repiten ni pierden eventos', async () => {
      await sembrarEventos(25);
      const vistos: number[] = [];
      for (const pagina of [1, 2, 3]) {
        const { body } = await consultar(`?usuarioId=${idEditor}&tamano=10&pagina=${pagina}`).expect(200);
        const datos = body as Pagina;
        expect(datos.total).toBe(25);
        expect(datos.pagina).toBe(pagina);
        expect(datos.tamano).toBe(10);
        vistos.push(...datos.items.map((e) => e.id));
      }
      expect(vistos).toHaveLength(25);
      expect(new Set(vistos).size).toBe(25);
    });

    it('la última página trae solo el resto y una página pasada del final viene vacía', async () => {
      await sembrarEventos(25);
      const ultima = await consultar(`?usuarioId=${idEditor}&tamano=10&pagina=3`).expect(200);
      expect((ultima.body as Pagina).items).toHaveLength(5);
      const mas = await consultar(`?usuarioId=${idEditor}&tamano=10&pagina=4`).expect(200);
      expect((mas.body as Pagina).items).toHaveLength(0);
      expect((mas.body as Pagina).total).toBe(25);
    });

    it('sin tamano usa 20', async () => {
      await sembrarEventos(30);
      const { body } = await consultar(`?usuarioId=${idEditor}`).expect(200);
      expect((body as Pagina).items).toHaveLength(20);
      expect((body as Pagina).tamano).toBe(20);
    });
  });
});
