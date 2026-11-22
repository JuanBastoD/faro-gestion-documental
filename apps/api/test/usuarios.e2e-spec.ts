import request from 'supertest';
import { sembrarCcdDemo } from '../src/semilla/ccd-demo.js';
import {
  CLAVE_DE_PRUEBA,
  crearApp,
  crearUsuario,
  ingresar,
  limpiarTablas,
  type AppDePrueba,
} from './ayudas.js';
import { generarPdf } from './pdfs.js';

interface Usuario {
  id: number;
  usuario: string;
  nombre: string;
  rol: string;
  activo: boolean;
  creadoEn: string;
}
interface Evento {
  accion: string;
  usuarioId: number | null;
  detalle: string | null;
}

const CLAVE_NUEVA = 'una-clave-larga-y-unica-2026';

describe('Administración de usuarios (contra PostgreSQL real)', () => {
  let ctx: AppDePrueba;
  let idAdmin: number;
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
    await crearUsuario(ctx.db, { usuario: 'editor', rol: 'editor' });
    await crearUsuario(ctx.db, { usuario: 'lector', rol: 'consulta' });
    cookieAdmin = await ingresar(ctx.app, 'admin');
  });

  const http = () => request(ctx.app.getHttpServer());
  const crear = (cuerpo: Record<string, unknown>, cookie = cookieAdmin) =>
    http().post('/usuarios').set('Cookie', cookie).send(cuerpo);
  const cambiar = (id: number | string, cuerpo: Record<string, unknown>, cookie = cookieAdmin) =>
    http().patch(`/usuarios/${id}`).set('Cookie', cookie).send(cuerpo);
  const valido = (extra: Record<string, unknown> = {}) => ({
    usuario: 'ana.perez',
    nombre: 'Ana Pérez',
    rol: 'editor',
    clave: CLAVE_NUEVA,
    ...extra,
  });
  const eventos = async (accion?: string): Promise<Evento[]> => {
    const { body } = await http().get('/auditoria').query({ tamano: 100 }).set('Cookie', cookieAdmin).expect(200);
    return (body.items as Evento[]).filter((e) => !accion || e.accion === accion);
  };
  const filaDe = async (usuario: string) =>
    (await ctx.pool.query('select * from usuarios where usuario = $1', [usuario])).rows[0];
  const idDe = async (usuario: string): Promise<number> => (await filaDe(usuario)).id;
  const cuenta = async (tabla: string) => (await ctx.pool.query(`select count(*)::int as n from ${tabla}`)).rows[0].n as number;

  describe('quién puede', () => {
    it('solo el administrador: el editor y el de consulta reciben 403 en todo, y queda en la auditoría', async () => {
      for (const quien of ['editor', 'lector']) {
        const cookie = await ingresar(ctx.app, quien);
        await http().get('/usuarios').set('Cookie', cookie).expect(403);
        await crear(valido(), cookie).expect(403);
        await cambiar(await idDe('lector'), { rol: 'administrador' }, cookie).expect(403);
      }
      expect(await cuenta('usuarios')).toBe(3);
      expect((await filaDe('lector')).rol).toBe('consulta');
      expect((await eventos('acceso_denegado')).length).toBeGreaterThanOrEqual(6);
    });

    it('sin sesión, 401', async () => {
      await http().get('/usuarios').expect(401);
      await http().post('/usuarios').send(valido()).expect(401);
      await http().patch('/usuarios/1').send({ activo: false }).expect(401);
    });
  });

  describe('crear', () => {
    it('crea el usuario, no devuelve la clave ni su hash, y la guarda con argon2id', async () => {
      const respuesta = await crear(valido()).expect(201);
      expect(respuesta.body).toMatchObject({ usuario: 'ana.perez', nombre: 'Ana Pérez', rol: 'editor', activo: true });
      expect(Object.keys(respuesta.body).sort()).toEqual(['activo', 'creadoEn', 'id', 'nombre', 'rol', 'usuario']);
      expect(JSON.stringify(respuesta.body)).not.toContain(CLAVE_NUEVA);

      const fila = await filaDe('ana.perez');
      expect(fila.clave_hash).toMatch(/^\$argon2id\$/);
      expect(fila.clave_hash).not.toContain(CLAVE_NUEVA);
      expect(fila.activo).toBe(true);
    });

    it('la persona creada puede ingresar con su clave, con el rol que se le dio', async () => {
      await crear(valido({ rol: 'consulta' })).expect(201);
      const ingreso = await http().post('/auth/login').send({ usuario: 'ana.perez', clave: CLAVE_NUEVA }).expect(200);
      expect(ingreso.body.usuario).toMatchObject({ usuario: 'ana.perez', rol: 'consulta' });
      await http().post('/auth/login').send({ usuario: 'ana.perez', clave: 'otra-clave-distinta-123' }).expect(401);
    });

    it('queda en la auditoría con quién lo hizo y sin la clave', async () => {
      const { body } = await crear(valido()).expect(201);
      const [evento] = await eventos('usuario_creado');
      expect(evento).toMatchObject({ usuarioId: idAdmin, detalle: `usuario ${body.id} (ana.perez); rol editor` });
      expect(JSON.stringify(await eventos())).not.toContain(CLAVE_NUEVA);
    });

    it('un nombre repetido es 409, sin cambiar al usuario existente', async () => {
      const antes = await filaDe('editor');
      const respuesta = await crear(valido({ usuario: 'editor', rol: 'administrador', clave: 'otra-clave-larga-1234' })).expect(409);
      expect(respuesta.body).toMatchObject({ codigo: 'usuario_existente' });
      const despues = await filaDe('editor');
      expect(despues.rol).toBe(antes.rol);
      expect(despues.clave_hash).toBe(antes.clave_hash);
      expect(await eventos('usuario_creado')).toHaveLength(0);
    });

    it('dos creaciones simultáneas del mismo nombre: una gana (201), la otra 409, nunca 500', async () => {
      const resultados = await Promise.all(
        Array.from({ length: 4 }, () => crear(valido({ usuario: 'carrera.1' }))),
      );
      const estados = resultados.map((r) => r.status).sort((a, b) => a - b);
      expect(estados).toEqual([201, 409, 409, 409]);
      expect((await ctx.pool.query(`select count(*)::int as n from usuarios where usuario = 'carrera.1'`)).rows[0].n).toBe(1);
      expect(await eventos('usuario_creado')).toHaveLength(1);
    });

    describe('datos inválidos: 400 y no se crea nada', () => {
      it.each([
        ['sin cuerpo', undefined],
        ['sin usuario', { nombre: 'A', rol: 'editor', clave: CLAVE_NUEVA }],
        ['usuario con mayúsculas', valido({ usuario: 'Ana.Perez' })],
        ['usuario muy corto', valido({ usuario: 'ab' })],
        ['usuario con espacios', valido({ usuario: 'ana perez' })],
        ['usuario con tilde', valido({ usuario: 'aná.perez' })],
        ['usuario que empieza con punto', valido({ usuario: '.ana' })],
        ['usuario de más de 64 caracteres', valido({ usuario: 'a'.repeat(65) })],
        ['sin nombre', valido({ nombre: '   ' })],
        ['nombre de más de 120 caracteres', valido({ nombre: 'n'.repeat(121) })],
        ['rol que no existe', valido({ rol: 'superusuario' })],
        ['sin rol', valido({ rol: undefined })],
        ['clave corta', valido({ clave: 'corta-123' })],
        ['clave de solo espacios', valido({ clave: ' '.repeat(20) })],
        ['clave de más de 256 caracteres', valido({ clave: 'x'.repeat(257) })],
        ['clave que no es texto', valido({ clave: 123456789012 })],
        ['un campo que no existe (activo)', valido({ activo: false })],
        ['un campo que no existe (clave_hash)', valido({ clave_hash: 'x' })],
      ])('%s', async (_nombre, cuerpo) => {
        const respuesta = await http().post('/usuarios').set('Cookie', cookieAdmin).send(cuerpo as object);
        expect(respuesta.status).toBe(400);
        expect(Array.isArray(respuesta.body.problemas)).toBe(true);
        expect(await cuenta('usuarios')).toBe(3);
      });

      it('el mensaje de error nunca repite la clave escrita', async () => {
        const secreta = 'corta-secr'; // 10 caracteres: menos del mínimo
        const respuesta = await crear(valido({ clave: secreta })).expect(400);
        expect(JSON.stringify(respuesta.body)).not.toContain(secreta);
      });
    });

    it('el nombre se guarda sin espacios sobrantes y el usuario también', async () => {
      const { body } = await crear(valido({ usuario: '  ana.perez  ', nombre: '  Ana Pérez  ' })).expect(201);
      expect(body).toMatchObject({ usuario: 'ana.perez', nombre: 'Ana Pérez' });
    });
  });

  describe('listar', () => {
    it('devuelve todos, activos e inactivos, por orden de creación y sin datos de la clave', async () => {
      await crear(valido()).expect(201);
      await cambiar(await idDe('lector'), { activo: false }).expect(200);
      const { body } = await http().get('/usuarios').set('Cookie', cookieAdmin).expect(200);
      expect((body as Usuario[]).map((u) => u.usuario)).toEqual(['admin', 'editor', 'lector', 'ana.perez']);
      expect((body as Usuario[]).map((u) => u.activo)).toEqual([true, true, false, true]);
      expect(JSON.stringify(body)).not.toMatch(/argon2|clave/);
    });
  });

  describe('cambiar el rol', () => {
    it('cambia el rol y rige al instante para quien ya tiene sesión', async () => {
      const cookieEditor = await ingresar(ctx.app, 'editor');
      const pdf = generarPdf(['rol cambia']);
      await sembrarCcdDemo(ctx.db);
      const { rows } = await ctx.pool.query(`select id from series_ccd where codigo = '100.1'`);
      const cargar = () =>
        http()
          .post('/documentos')
          .set('Cookie', cookieEditor)
          .field('titulo', 'Documento')
          .field('expediente', 'EXP-1')
          .field('serieId', String(rows[0].id))
          .field('fechaDocumento', '2026-03-02')
          .attach('archivo', pdf, { filename: 'd.pdf', contentType: 'application/pdf' });

      await cargar().expect(201);
      const { body } = await cambiar(await idDe('editor'), { rol: 'consulta' }).expect(200);
      expect(body).toMatchObject({ usuario: 'editor', rol: 'consulta', activo: true });
      // La misma sesión, sin volver a ingresar, ya no puede cargar.
      await cargar().expect(403);
      expect((await http().get('/auth/yo').set('Cookie', cookieEditor).expect(200)).body.usuario.rol).toBe('consulta');
    });

    it('queda en la auditoría con el rol anterior y el nuevo', async () => {
      const id = await idDe('editor');
      await cambiar(id, { rol: 'consulta' }).expect(200);
      expect(await eventos('usuario_rol_cambiado')).toEqual([
        expect.objectContaining({ usuarioId: idAdmin, detalle: `usuario ${id} (editor); rol editor → consulta` }),
      ]);
    });

    it('un administrador puede promover a otro usuario', async () => {
      await cambiar(await idDe('lector'), { rol: 'administrador' }).expect(200);
      const cookie = await ingresar(ctx.app, 'lector');
      await http().get('/usuarios').set('Cookie', cookie).expect(200);
    });
  });

  describe('desactivar y reactivar', () => {
    it('un usuario inactivo no ingresa, y queda en la auditoría como intento fallido', async () => {
      await cambiar(await idDe('editor'), { activo: false }).expect(200);
      await http().post('/auth/login').send({ usuario: 'editor', clave: CLAVE_DE_PRUEBA }).expect(401);
      const fallidos = (await eventos('ingreso_fallido')).map((e) => e.detalle);
      expect(fallidos).toContain('usuario inactivo');
    });

    it('cierra sus sesiones al instante: la que estaba abierta deja de servir y las filas se borran', async () => {
      const id = await idDe('editor');
      const cookie1 = await ingresar(ctx.app, 'editor');
      const cookie2 = await ingresar(ctx.app, 'editor');
      await http().get('/auth/yo').set('Cookie', cookie1).expect(200);
      expect((await ctx.pool.query('select count(*)::int as n from sesiones where usuario_id = $1', [id])).rows[0].n).toBe(2);

      await cambiar(id, { activo: false }).expect(200);

      await http().get('/documentos').set('Cookie', cookie1).expect(401);
      await http().get('/documentos').set('Cookie', cookie2).expect(401);
      expect((await ctx.pool.query('select count(*)::int as n from sesiones where usuario_id = $1', [id])).rows[0].n).toBe(0);
      // La sesión del administrador que lo hizo no se toca.
      await http().get('/usuarios').set('Cookie', cookieAdmin).expect(200);
      expect(await eventos('usuario_desactivado')).toEqual([
        expect.objectContaining({ usuarioId: idAdmin, detalle: `usuario ${id} (editor); sesiones cerradas: 2` }),
      ]);
    });

    it('conserva al usuario y todo lo que hizo: nada se borra', async () => {
      await sembrarCcdDemo(ctx.db);
      const { rows } = await ctx.pool.query(`select id from series_ccd where codigo = '100.1'`);
      const cookieEditor = await ingresar(ctx.app, 'editor');
      const { body } = await http()
        .post('/documentos')
        .set('Cookie', cookieEditor)
        .field('titulo', 'Lo que cargó')
        .field('expediente', 'EXP-1')
        .field('serieId', String(rows[0].id))
        .field('fechaDocumento', '2026-03-02')
        .attach('archivo', generarPdf(['trazabilidad']), { filename: 'd.pdf', contentType: 'application/pdf' })
        .expect(201);
      const id = await idDe('editor');
      await cambiar(id, { activo: false }).expect(200);

      expect(await cuenta('usuarios')).toBe(3);
      const { rows: docs } = await ctx.pool.query('select creado_por from documentos where id = $1', [body.documento.id]);
      expect(docs[0].creado_por).toBe(id);
      expect(await eventos('carga')).toHaveLength(1);
      expect((await eventos('carga'))[0].usuarioId).toBe(id);
    });

    it('al reactivarlo puede volver a ingresar, y queda en la auditoría', async () => {
      const id = await idDe('editor');
      await cambiar(id, { activo: false }).expect(200);
      await cambiar(id, { activo: true }).expect(200);
      await ingresar(ctx.app, 'editor');
      expect(await eventos('usuario_reactivado')).toEqual([
        expect.objectContaining({ usuarioId: idAdmin, detalle: `usuario ${id} (editor)` }),
      ]);
    });

    it('cambiar rol y actividad a la vez registra un evento por cada cambio', async () => {
      const id = await idDe('editor');
      await cambiar(id, { rol: 'consulta', activo: false }).expect(200);
      expect(await eventos('usuario_rol_cambiado')).toHaveLength(1);
      expect(await eventos('usuario_desactivado')).toHaveLength(1);
    });
  });

  describe('cambios que no cambian nada o están mal', () => {
    it('repetir el valor que ya tiene responde 200 y no deja evento', async () => {
      const id = await idDe('editor');
      const { body } = await cambiar(id, { rol: 'editor', activo: true }).expect(200);
      expect(body).toMatchObject({ usuario: 'editor', rol: 'editor', activo: true });
      for (const accion of ['usuario_rol_cambiado', 'usuario_desactivado', 'usuario_reactivado']) {
        expect(await eventos(accion)).toHaveLength(0);
      }
    });

    it.each([
      ['cuerpo vacío', {}],
      ['rol que no existe', { rol: 'jefe' }],
      ['activo que no es booleano', { activo: 'no' }],
      ['activo como número', { activo: 0 }],
      ['un campo que no se puede cambiar (usuario)', { usuario: 'otro.nombre' }],
      ['un campo que no se puede cambiar (clave)', { clave: CLAVE_NUEVA }],
      ['un campo que no se puede cambiar (nombre)', { nombre: 'Otro' }],
    ])('%s: 400 y no cambia nada', async (_nombre, cuerpo) => {
      const antes = await filaDe('editor');
      await cambiar(antes.id, cuerpo).expect(400);
      expect(await filaDe('editor')).toEqual(antes);
    });

    it('un usuario que no existe: 404; un identificador mal escrito: 400', async () => {
      await cambiar(9999, { activo: false }).expect(404);
      await cambiar('abc', { activo: false }).expect(400);
      await cambiar('0', { activo: false }).expect(400);
      await cambiar('99999999999', { activo: false }).expect(400);
    });
  });

  describe('el último administrador', () => {
    const intentos = (id: number) => [{ activo: false }, { rol: 'editor' }, { rol: 'consulta', activo: false }].map((c) => cambiar(id, c));

    it('el único administrador no puede desactivarse ni cambiarse el rol: 409 y todo queda igual', async () => {
      for (const cambio of [{ activo: false }, { rol: 'editor' }, { rol: 'consulta' }, { rol: 'editor', activo: false }]) {
        const respuesta = await cambiar(idAdmin, cambio).expect(409);
        expect(respuesta.body).toMatchObject({ codigo: 'ultimo_administrador' });
      }
      expect(await filaDe('admin')).toMatchObject({ rol: 'administrador', activo: true });
      await http().get('/usuarios').set('Cookie', cookieAdmin).expect(200);
      expect(await eventos('usuario_rol_cambiado')).toHaveLength(0);
      expect(await eventos('usuario_desactivado')).toHaveLength(0);
    });

    it('con dos administradores, uno puede dejar de serlo; el que queda ya es el último', async () => {
      const idOtro = await crearUsuario(ctx.db, { usuario: 'otro.admin', rol: 'administrador' });
      await cambiar(idOtro, { rol: 'editor' }).expect(200);
      await cambiar(idAdmin, { activo: false }).expect(409);
    });

    it('un administrador inactivo no cuenta como administrador activo', async () => {
      await crearUsuario(ctx.db, { usuario: 'admin.inactivo', rol: 'administrador', activo: false });
      await cambiar(idAdmin, { rol: 'editor' }).expect(409);
      // Reactivarlo lo devuelve a la cuenta, y entonces el primero sí puede irse.
      await cambiar(await idDe('admin.inactivo'), { activo: true }).expect(200);
      await cambiar(idAdmin, { rol: 'editor' }).expect(200);
    });

    it('un administrador puede desactivarse a sí mismo si queda otro, y su sesión muere', async () => {
      await crearUsuario(ctx.db, { usuario: 'otro.admin', rol: 'administrador' });
      await cambiar(idAdmin, { activo: false }).expect(200);
      await http().get('/usuarios').set('Cookie', cookieAdmin).expect(401);
    });

    it('dos administradores que se degradan a la vez: solo uno lo logra y siempre queda uno activo', async () => {
      for (let vuelta = 0; vuelta < 5; vuelta++) {
        await limpiarTablas(ctx.pool);
        const a = await crearUsuario(ctx.db, { usuario: 'admin.a', rol: 'administrador' });
        const b = await crearUsuario(ctx.db, { usuario: 'admin.b', rol: 'administrador' });
        const cookieA = await ingresar(ctx.app, 'admin.a');
        const cookieB = await ingresar(ctx.app, 'admin.b');

        const [deAaB, deBaA] = await Promise.all([
          cambiar(b, { rol: 'consulta' }, cookieA),
          cambiar(a, { activo: false }, cookieB),
        ]);
        expect([deAaB.status, deBaA.status].sort((x, y) => x - y), `vuelta ${vuelta}`).toEqual([200, 409]);
        const { rows } = await ctx.pool.query(
          `select count(*)::int as n from usuarios where rol = 'administrador' and activo`,
        );
        expect(rows[0].n, `vuelta ${vuelta}`).toBe(1);
      }
    });

    it('muchos cambios simultáneos sobre los administradores nunca dejan al sistema sin uno', async () => {
      const ids = [idAdmin];
      for (const nombre of ['admin.2', 'admin.3']) ids.push(await crearUsuario(ctx.db, { usuario: nombre, rol: 'administrador' }));
      const respuestas = await Promise.all(ids.flatMap((id) => intentos(id)));
      // Las peticiones usan la sesión de un administrador que a la vez se degrada: 401 y 403 son legítimos; 500, no.
      expect(respuestas.every((r) => [200, 401, 403, 409].includes(r.status))).toBe(true);
      const { rows } = await ctx.pool.query(
        `select count(*)::int as n from usuarios where rol = 'administrador' and activo`,
      );
      expect(rows[0].n).toBeGreaterThanOrEqual(1);
    });
  });

  describe('auditoría', () => {
    it('ningún evento de usuarios guarda claves ni hashes', async () => {
      await crear(valido()).expect(201);
      await cambiar(await idDe('ana.perez'), { activo: false }).expect(200);
      const texto = JSON.stringify(await eventos());
      expect(texto).not.toContain(CLAVE_NUEVA);
      expect(texto).not.toContain('argon2');
    });
  });
});
