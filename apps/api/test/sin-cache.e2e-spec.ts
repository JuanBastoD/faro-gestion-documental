/**
 * Revisión C3, H-07: ninguna respuesta de la API (JSON, PDF, errores) debe guardarse en la caché del navegador.
 * `Cache-Control: no-store` en todo, salvo la interfaz web bajo `/app/`, que tiene su propia política (ADR-012).
 */
import { Controller, Get } from '@nestjs/common';
import request from 'supertest';
import { Publico } from '../src/auth/decoradores.js';
import { sembrarCcdDemo } from '../src/semilla/ccd-demo.js';
import { crearApp, crearUsuario, ingresar, limpiarTablas, type AppDePrueba } from './ayudas.js';
import { generarPdf } from './pdfs.js';

/** Rutas que existen solo en esta prueba: una bajo `/app/` (la interfaz) y otra con un prefijo parecido. */
@Controller('app')
class ControladorBajoApp {
  @Publico()
  @Get('prueba')
  prueba() {
    return { ok: true };
  }
}

@Controller('aplicacion')
class ControladorConPrefijoParecido {
  @Publico()
  @Get()
  prueba() {
    return { ok: true };
  }
}

describe('Cache-Control: no-store en la API (contra PostgreSQL real)', () => {
  let ctx: AppDePrueba;
  let cookieEditor: string;
  let idDocumento: number;

  beforeAll(async () => {
    ctx = await crearApp([ControladorBajoApp, ControladorConPrefijoParecido]);
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await limpiarTablas(ctx.pool);
    await crearUsuario(ctx.db, { usuario: 'editor', rol: 'editor' });
    await crearUsuario(ctx.db, { usuario: 'lector', rol: 'consulta' });
    await sembrarCcdDemo(ctx.db);
    const { rows } = await ctx.pool.query(`select id from series_ccd where codigo = '100.1'`);
    cookieEditor = await ingresar(ctx.app, 'editor');
    const cargado = await http()
      .post('/documentos')
      .set('Cookie', cookieEditor)
      .field('titulo', 'Acta de inicio')
      .field('expediente', 'EXP-001')
      .field('serieId', String(rows[0].id))
      .field('fechaDocumento', '2026-03-02')
      .attach('archivo', generarPdf(['Acta de inicio']), { filename: 'acta.pdf', contentType: 'application/pdf' })
      .expect(201);
    idDocumento = cargado.body.documento.id as number;
  });

  const http = () => request(ctx.app.getHttpServer());

  /** Lo que dice la cabecera: `undefined` si la respuesta no la lleva. */
  const cache = (respuesta: request.Response): string | undefined => respuesta.headers['cache-control'];

  describe('lleva no-store', () => {
    it('un listado y el detalle de un documento (JSON con sesión)', async () => {
      const listado = await http().get('/documentos').set('Cookie', cookieEditor).expect(200);
      expect(cache(listado)).toBe('no-store');
      const detalle = await http().get(`/documentos/${idDocumento}`).set('Cookie', cookieEditor).expect(200);
      expect(cache(detalle)).toBe('no-store');
      const series = await http().get('/series').set('Cookie', cookieEditor).expect(200);
      expect(cache(series)).toBe('no-store');
    });

    it('la descarga de un PDF', async () => {
      const respuesta = await http()
        .get(`/documentos/${idDocumento}/versiones/1/archivo`)
        .set('Cookie', cookieEditor)
        .buffer(true)
        .parse((res, fin) => {
          const trozos: Buffer[] = [];
          res.on('data', (t: Buffer) => trozos.push(t));
          res.on('end', () => fin(null, Buffer.concat(trozos)));
        })
        .expect(200);
      expect(respuesta.headers['content-type']).toMatch(/application\/pdf/);
      expect(respuesta.headers['content-disposition']).toMatch(/^attachment; filename=/);
      expect(cache(respuesta)).toBe('no-store');
    });

    it('quién soy (con y sin sesión), el ingreso y la comprobación de salud', async () => {
      const conSesion = await http().get('/auth/yo').set('Cookie', cookieEditor).expect(200);
      expect(cache(conSesion)).toBe('no-store');
      expect(cache(await http().get('/auth/yo').expect(401))).toBe('no-store');
      const ingreso = await http().post('/auth/login').send({ usuario: 'editor', clave: 'clave-de-prueba-123' }).expect(200);
      expect(cache(ingreso)).toBe('no-store');
      expect(cache(await http().get('/health').expect(200))).toBe('no-store');
    });

    it('los errores también: 401 sin sesión, 403 por rol, 400 por datos inválidos y 404 de una ruta que no existe', async () => {
      const sinSesion = await http().get('/documentos').expect(401);
      expect(cache(sinSesion)).toBe('no-store');
      const sinPermiso = await http().get('/usuarios').set('Cookie', cookieEditor).expect(403);
      expect(cache(sinPermiso)).toBe('no-store');
      const invalido = await http().post('/auth/login').send({}).expect(400);
      expect(cache(invalido)).toBe('no-store');
      const noExiste = await http().get('/ruta-que-no-existe').expect(404);
      expect(cache(noExiste)).toBe('no-store');
      const documentoAusente = await http().get('/documentos/99999').set('Cookie', cookieEditor).expect(404);
      expect(cache(documentoAusente)).toBe('no-store');
    });

    it('un prefijo parecido a /app (como /aplicacion o /apps) no es la interfaz', async () => {
      expect(cache(await http().get('/aplicacion').expect(200))).toBe('no-store');
      expect(cache(await http().get('/apps').expect(404))).toBe('no-store');
      expect(cache(await http().get('/appx/prueba').expect(404))).toBe('no-store');
    });
  });

  describe('no lo lleva lo que es de la interfaz bajo /app/', () => {
    it('una ruta bajo /app/ no recibe no-store (la política de caché es de la interfaz, ADR-012)', async () => {
      const respuesta = await http().get('/app/prueba').expect(200);
      expect(cache(respuesta)).toBeUndefined();
    });

    it('ni /app, ni /app/ ni una ruta de la interfaz que la API no sirve', async () => {
      expect(cache(await http().get('/app/'))).toBeUndefined();
      expect(cache(await http().get('/app'))).toBeUndefined();
      expect(cache(await http().get('/app/documentos/12'))).toBeUndefined();
    });
  });
});
