import { createHash } from 'node:crypto';
import request from 'supertest';
import { AuditoriaService } from '../src/auditoria/auditoria.service.js';
import { claveDeObjeto } from '../src/documentos/archivo-preparado.js';
import { sembrarCcdDemo } from '../src/semilla/ccd-demo.js';
import {
  crearApp,
  crearUsuario,
  eventos,
  ingresar,
  limpiarTablas,
  type AppDePrueba,
} from './ayudas.js';
import { generarPdf, pdfDeTamano } from './pdfs.js';

const sha256 = (datos: Buffer) => createHash('sha256').update(datos).digest('hex');

describe('Carga y consulta de documentos (contra PostgreSQL real)', () => {
  let ctx: AppDePrueba;
  let cookieEditor: string;
  let cookieAdmin: string;
  let cookieLector: string;
  let idEditor: number;
  let subserie: number;
  let serieRaiz: number;

  beforeAll(async () => {
    ctx = await crearApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await limpiarTablas(ctx.pool);
    await crearUsuario(ctx.db, { usuario: 'admin', rol: 'administrador' });
    idEditor = await crearUsuario(ctx.db, { usuario: 'editor', rol: 'editor' });
    await crearUsuario(ctx.db, { usuario: 'lector', rol: 'consulta' });
    await sembrarCcdDemo(ctx.db);
    const { rows } = await ctx.pool.query(`select id, codigo from series_ccd where codigo in ('100','100.1')`);
    subserie = rows.find((r) => r.codigo === '100.1').id;
    serieRaiz = rows.find((r) => r.codigo === '100').id;
    cookieEditor = await ingresar(ctx.app, 'editor');
    cookieAdmin = await ingresar(ctx.app, 'admin');
    cookieLector = await ingresar(ctx.app, 'lector');
  });

  const http = () => request(ctx.app.getHttpServer());

  /** Envía el formulario de carga. `campos` puede omitir o sobrescribir cualquier dato. */
  function cargar(
    cookie: string,
    archivo: { datos: Buffer; nombre?: string; tipo?: string } | null,
    campos: Record<string, string | undefined> = {},
  ) {
    const datos: Record<string, string | undefined> = {
      titulo: 'Acta de inicio',
      expediente: 'EXP-001',
      serieId: String(subserie),
      fechaDocumento: '2026-03-02',
      ...campos,
    };
    let peticion = http().post('/documentos').set('Cookie', cookie);
    for (const [campo, valor] of Object.entries(datos)) {
      if (valor !== undefined) peticion = peticion.field(campo, valor);
    }
    if (archivo) {
      peticion = peticion.attach('archivo', archivo.datos, {
        filename: archivo.nombre ?? 'acta.pdf',
        contentType: archivo.tipo ?? 'application/pdf',
      });
    }
    return peticion;
  }

  const contar = async (tabla: 'documentos' | 'versiones') =>
    (await ctx.pool.query(`select count(*)::int as n from ${tabla}`)).rows[0].n as number;

  describe('carga correcta', () => {
    it('el editor carga un PDF: crea documento, versión 1, objeto y evento de auditoría', async () => {
      const pdf = generarPdf(['Acta de inicio', 'Contrato DEMO-001']);
      const respuesta = await cargar(cookieEditor, { datos: pdf, nombre: 'acta-inicio.pdf' }).expect(201);

      const { documento, version } = respuesta.body;
      expect(documento).toMatchObject({
        titulo: 'Acta de inicio',
        expediente: 'EXP-001',
        serieId: subserie,
        serieCodigo: '100.1',
        fechaDocumento: '2026-03-02',
        creadoPor: idEditor,
      });
      expect(version).toMatchObject({
        numero: 1,
        nombreOriginal: 'acta-inicio.pdf',
        sha256: sha256(pdf),
        tamano: pdf.length,
        motivo: 'Carga inicial',
        autor: 'editor',
      });

      expect(await contar('documentos')).toBe(1);
      expect(await contar('versiones')).toBe(1);

      const clave = claveDeObjeto(sha256(pdf));
      expect(await ctx.almacen.existe(clave)).toBe(true);
      expect((await ctx.almacen.leer(clave)).equals(pdf)).toBe(true);

      const cargas = await eventos(ctx.pool, 'carga');
      expect(cargas).toHaveLength(1);
      expect(cargas[0].usuario_id).toBe(idEditor);
    });

    it('los campos de texto con tildes y eñes se guardan tal cual (título, expediente y motivo)', async () => {
      const { body } = await cargar(
        cookieEditor,
        { datos: generarPdf(['Tildes en campos']) },
        { titulo: 'Interventoría: cláusula de garantía año 2', expediente: 'EXP-Ñandú', motivo: 'Corrección de cláusula' },
      ).expect(201);
      expect(body.documento).toMatchObject({
        titulo: 'Interventoría: cláusula de garantía año 2',
        expediente: 'EXP-Ñandú',
      });
      expect(body.version.motivo).toBe('Corrección de cláusula');
    });

    it('el administrador también puede cargar', async () => {
      await cargar(cookieAdmin, { datos: generarPdf(['Informe admin']) }).expect(201);
    });

    it('respeta el motivo que se indique', async () => {
      const { body } = await cargar(cookieEditor, { datos: generarPdf(['Con motivo']) }, { motivo: 'Entrega del contratista' }).expect(201);
      expect(body.version.motivo).toBe('Entrega del contratista');
    });

    it('conserva las tildes del nombre del archivo', async () => {
      const { body } = await cargar(cookieEditor, { datos: generarPdf(['Tildes']), nombre: 'Interventoría año 2026.pdf' }).expect(201);
      expect(body.version.nombreOriginal).toBe('Interventoría año 2026.pdf');
    });

    it('quita las carpetas de un nombre con rutas', async () => {
      const { body } = await cargar(cookieEditor, { datos: generarPdf(['Ruta']), nombre: '..\\..\\secreto\\acta.pdf' }).expect(201);
      expect(body.version.nombreOriginal).toBe('acta.pdf');
    });

    it('acepta un archivo justo bajo el límite de 20 MB', async () => {
      await cargar(cookieEditor, { datos: pdfDeTamano(19) }).expect(201);
    }, 60000);

    it('guarda el mismo contenido dos veces bajo la misma clave sin romper nada', async () => {
      const pdf = generarPdf(['Contenido repetido']);
      await cargar(cookieEditor, { datos: pdf }, { titulo: 'Primero', expediente: 'EXP-A' }).expect(201);
      await cargar(cookieEditor, { datos: pdf }, { titulo: 'Segundo', expediente: 'EXP-B' }).expect(201);
      expect(await contar('documentos')).toBe(2);
      expect(await ctx.almacen.existe(claveDeObjeto(sha256(pdf)))).toBe(true);
    });
  });

  describe('quién puede cargar', () => {
    it('el rol de consulta recibe 403, no sube nada y queda registrado', async () => {
      const pdf = generarPdf(['Intento de consulta']);
      await cargar(cookieLector, { datos: pdf }).expect(403);
      expect(await contar('documentos')).toBe(0);
      expect(await ctx.almacen.existe(claveDeObjeto(sha256(pdf)))).toBe(false);
      expect(await eventos(ctx.pool, 'acceso_denegado')).toHaveLength(1);
    });

    it('sin sesión recibe 401', async () => {
      const pdf = generarPdf(['Sin sesion']);
      const respuesta = await http()
        .post('/documentos')
        .field('titulo', 'x')
        .attach('archivo', pdf, { filename: 'a.pdf', contentType: 'application/pdf' });
      expect(respuesta.status).toBe(401);
      expect(await ctx.almacen.existe(claveDeObjeto(sha256(pdf)))).toBe(false);
    });
  });

  describe('lo que se rechaza', () => {
    it('un archivo que no es PDF, aunque se llame .pdf y diga ser application/pdf: 415', async () => {
      const texto = Buffer.from('Esto es texto plano disfrazado de PDF');
      await cargar(cookieEditor, { datos: texto, nombre: 'falso.pdf', tipo: 'application/pdf' }).expect(415);
      expect(await contar('documentos')).toBe(0);
      expect(await ctx.almacen.existe(claveDeObjeto(sha256(texto)))).toBe(false);
    });

    it('una imagen PNG: 415', async () => {
      const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
      await cargar(cookieEditor, { datos: png, nombre: 'foto.png', tipo: 'image/png' }).expect(415);
    });

    it('un PDF real con el nombre y el tipo equivocados sí se acepta: manda el contenido', async () => {
      await cargar(cookieEditor, { datos: generarPdf(['Real']), nombre: 'sin-extension', tipo: 'application/octet-stream' }).expect(201);
    });

    it('más de 20 MB: 413, sin guardar nada', async () => {
      const grande = pdfDeTamano(21);
      await cargar(cookieEditor, { datos: grande }).expect(413);
      expect(await contar('documentos')).toBe(0);
      expect(await ctx.almacen.existe(claveDeObjeto(sha256(grande)))).toBe(false);
    }, 60000);

    it('sin archivo: 400', async () => {
      const { body } = await cargar(cookieEditor, null).expect(400);
      expect(body.message).toMatch(/archivo/i);
    });

    it('un archivo vacío: 415', async () => {
      await cargar(cookieEditor, { datos: Buffer.alloc(0) }).expect(415);
    });

    it('un archivo en un campo con otro nombre: 400', async () => {
      await http()
        .post('/documentos')
        .set('Cookie', cookieEditor)
        .field('titulo', 'x')
        .field('expediente', 'x')
        .field('serieId', String(subserie))
        .field('fechaDocumento', '2026-03-02')
        .attach('documento', generarPdf(['Campo equivocado']), { filename: 'a.pdf', contentType: 'application/pdf' })
        .expect(400);
    });

    it.each([
      ['sin título', { titulo: undefined }, 'titulo'],
      ['sin expediente', { expediente: undefined }, 'expediente'],
      ['sin serie', { serieId: undefined }, 'serieId'],
      ['serie no numérica', { serieId: 'abc' }, 'serieId'],
      ['sin fecha', { fechaDocumento: undefined }, 'fechaDocumento'],
      ['fecha imposible', { fechaDocumento: '2026-02-30' }, 'fechaDocumento'],
      ['título demasiado largo', { titulo: 'x'.repeat(201) }, 'titulo'],
    ])('datos incompletos o inválidos (%s): 400 que nombra el campo', async (_caso, campos, campo) => {
      const pdf = generarPdf([`Datos malos ${campo}`]);
      const { body } = await cargar(cookieEditor, { datos: pdf }, campos).expect(400);
      expect(body.problemas.join(' ')).toContain(campo);
      expect(await contar('documentos')).toBe(0);
      expect(await ctx.almacen.existe(claveDeObjeto(sha256(pdf)))).toBe(false);
    });

    it('una serie (no subserie): 422 y no se guarda nada', async () => {
      const pdf = generarPdf(['En una serie raíz']);
      const { body } = await cargar(cookieEditor, { datos: pdf }, { serieId: String(serieRaiz) }).expect(422);
      expect(body.message).toMatch(/subserie/);
      expect(await contar('documentos')).toBe(0);
      expect(await ctx.almacen.existe(claveDeObjeto(sha256(pdf)))).toBe(false);
    });

    it('una serie que no existe: 422', async () => {
      await cargar(cookieEditor, { datos: generarPdf(['Serie fantasma']) }, { serieId: '999999' }).expect(422);
    });
  });

  describe('sin estados a medias', () => {
    it('si falla la transacción no queda registro ni archivo', async () => {
      const auditoria = ctx.app.get(AuditoriaService);
      const original = auditoria.registrar.bind(auditoria);
      const espia = vi.spyOn(auditoria, 'registrar').mockImplementation(async (evento, ejecutor) => {
        if (evento.accion === 'carga') throw new Error('falla simulada de auditoría');
        return original(evento, ejecutor);
      });
      try {
        const pdf = generarPdf(['Carga que falla']);
        await cargar(cookieEditor, { datos: pdf }).expect(500);
        expect(await contar('documentos')).toBe(0);
        expect(await contar('versiones')).toBe(0);
        expect(await ctx.almacen.existe(claveDeObjeto(sha256(pdf)))).toBe(false);
        expect(await eventos(ctx.pool, 'carga')).toHaveLength(0);
      } finally {
        espia.mockRestore();
      }
    });

    it('si falla pero otro documento ya usa ese archivo, el archivo no se borra', async () => {
      const pdf = generarPdf(['Archivo compartido']);
      await cargar(cookieEditor, { datos: pdf }, { titulo: 'Original', expediente: 'EXP-1' }).expect(201);

      const auditoria = ctx.app.get(AuditoriaService);
      const original = auditoria.registrar.bind(auditoria);
      const espia = vi.spyOn(auditoria, 'registrar').mockImplementation(async (evento, ejecutor) => {
        if (evento.accion === 'carga') throw new Error('falla simulada de auditoría');
        return original(evento, ejecutor);
      });
      try {
        await cargar(cookieEditor, { datos: pdf }, { titulo: 'Copia', expediente: 'EXP-2' }).expect(500);
      } finally {
        espia.mockRestore();
      }
      expect(await contar('documentos')).toBe(1);
      expect(await ctx.almacen.existe(claveDeObjeto(sha256(pdf)))).toBe(true);
    });
  });

  describe('consulta y descarga', () => {
    async function cargarUno(titulo: string, lineas: string[]) {
      const pdf = generarPdf(lineas);
      const { body } = await cargar(cookieEditor, { datos: pdf, nombre: `${titulo}.pdf` }, { titulo, expediente: `EXP-${titulo}` }).expect(201);
      return { pdf, id: body.documento.id as number };
    }

    it.each(['cookieAdmin', 'cookieEditor', 'cookieLector'] as const)('%s ve el detalle con su historial', async (quien) => {
      const { id } = await cargarUno('Detalle', ['Documento de detalle']);
      const cookie = { cookieAdmin, cookieEditor, cookieLector }[quien];
      const { body } = await http().get(`/documentos/${id}`).set('Cookie', cookie).expect(200);
      expect(body).toMatchObject({ id, titulo: 'Detalle', serieCodigo: '100.1' });
      expect(body.versiones).toHaveLength(1);
      expect(body.versiones[0]).toMatchObject({ numero: 1, autor: 'editor' });
    });

    it('un documento que no existe: 404; un identificador mal escrito: 400', async () => {
      await http().get('/documentos/99999').set('Cookie', cookieLector).expect(404);
      await http().get('/documentos/abc').set('Cookie', cookieLector).expect(400);
      await http().get('/documentos/0').set('Cookie', cookieLector).expect(400);
      await http().get('/documentos/99999999999').set('Cookie', cookieLector).expect(400);
    });

    it('sin sesión no se ve nada', async () => {
      await http().get('/documentos').expect(401);
      await http().get('/documentos/1').expect(401);
      await http().get('/documentos/1/versiones/1/archivo').expect(401);
    });

    it('el rol de consulta descarga el PDF idéntico y la descarga queda en la auditoría', async () => {
      const { pdf, id } = await cargarUno('Descargable', ['Para descargar', 'Interventoría']);
      const respuesta = await http()
        .get(`/documentos/${id}/versiones/1/archivo`)
        .set('Cookie', cookieLector)
        .buffer(true)
        .parse((res, fin) => {
          const trozos: Buffer[] = [];
          res.on('data', (t: Buffer) => trozos.push(t));
          res.on('end', () => fin(null, Buffer.concat(trozos)));
        })
        .expect(200);
      expect(respuesta.headers['content-type']).toMatch(/application\/pdf/);
      expect(respuesta.headers['content-disposition']).toMatch(/^attachment; filename="Descargable\.pdf"/);
      expect((respuesta.body as Buffer).equals(pdf)).toBe(true);

      const descargas = await eventos(ctx.pool, 'descarga');
      expect(descargas).toHaveLength(1);
      expect(descargas[0].detalle).toBe('versión 1');
    });

    it('una versión que no existe: 404 y sin evento de descarga', async () => {
      const { id } = await cargarUno('SinV2', ['Solo una versión']);
      await http().get(`/documentos/${id}/versiones/2/archivo`).set('Cookie', cookieLector).expect(404);
      expect(await eventos(ctx.pool, 'descarga')).toHaveLength(0);
    });

    it('si falta el archivo en el almacén, 404 claro y sin evento de descarga', async () => {
      const { pdf, id } = await cargarUno('Perdido', ['Archivo que se pierde']);
      await ctx.almacen.borrar(claveDeObjeto(sha256(pdf)));
      const { body } = await http().get(`/documentos/${id}/versiones/1/archivo`).set('Cookie', cookieLector).expect(404);
      expect(body.message).toMatch(/no está disponible/);
      expect(await eventos(ctx.pool, 'descarga')).toHaveLength(0);
    });

    it('el listado trae los más recientes primero, con paginación', async () => {
      for (const n of [1, 2, 3]) await cargarUno(`Doc${n}`, [`Contenido ${n}`]);
      const primera = await http().get('/documentos?tamano=2').set('Cookie', cookieLector).expect(200);
      expect(primera.body).toMatchObject({ total: 3, pagina: 1, tamano: 2 });
      expect(primera.body.items.map((d: { titulo: string }) => d.titulo)).toEqual(['Doc3', 'Doc2']);
      expect(primera.body.items[0]).toMatchObject({ serieCodigo: '100.1', versionActual: 1 });
      const segunda = await http().get('/documentos?tamano=2&pagina=2').set('Cookie', cookieLector).expect(200);
      expect(segunda.body.items.map((d: { titulo: string }) => d.titulo)).toEqual(['Doc1']);
    });

    it.each(['pagina=0', 'tamano=51', 'tamano=abc'])('listado con %s: 400', async (consulta) => {
      await http().get(`/documentos?${consulta}`).set('Cookie', cookieLector).expect(400);
    });
  });
});
