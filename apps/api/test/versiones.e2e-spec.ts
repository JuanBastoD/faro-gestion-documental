import { createHash } from 'node:crypto';
import request from 'supertest';
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

interface VersionJson {
  numero: number;
  nombreOriginal: string;
  sha256: string;
  tamano: number;
  motivo: string;
  restauradaDe: number | null;
  autor: string;
  creadoEn: string;
}

describe('Versiones, historial y restauración (contra PostgreSQL real)', () => {
  let ctx: AppDePrueba;
  let cookieEditor: string;
  let cookieAdmin: string;
  let cookieLector: string;
  let subserie: number;

  // Tres contenidos distintos y fijos para todo el archivo.
  const v1 = generarPdf(['Versión uno del contrato', 'Contenido original']);
  const v2 = generarPdf(['Versión dos del contrato', 'Se corrigió el valor']);
  const v3 = generarPdf(['Versión tres del contrato', 'Se agregó una cláusula']);
  // Primera versión de un segundo documento: desde #12 el mismo PDF no se puede cargar dos veces.
  const otroV1 = generarPdf(['Otro contrato distinto', 'Contenido de otro expediente']);

  beforeAll(async () => {
    ctx = await crearApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await limpiarTablas(ctx.pool);
    // Los tres PDFs son fijos y se repiten entre pruebas: el almacén empieza vacío en cada una.
    for (const objeto of await ctx.almacen.listar('documentos/')) await ctx.almacen.borrar(objeto.clave);
    await crearUsuario(ctx.db, { usuario: 'admin', rol: 'administrador' });
    await crearUsuario(ctx.db, { usuario: 'editor', rol: 'editor' });
    await crearUsuario(ctx.db, { usuario: 'lector', rol: 'consulta' });
    await sembrarCcdDemo(ctx.db);
    const { rows } = await ctx.pool.query(`select id from series_ccd where codigo = '100.1'`);
    subserie = rows[0].id;
    cookieEditor = await ingresar(ctx.app, 'editor');
    cookieAdmin = await ingresar(ctx.app, 'admin');
    cookieLector = await ingresar(ctx.app, 'lector');
  });

  const http = () => request(ctx.app.getHttpServer());

  /** Carga un documento con v1 y devuelve su id. */
  async function crearDocumento(contenido: Buffer = v1, nombre = 'contrato-v1.pdf'): Promise<number> {
    const { body } = await http()
      .post('/documentos')
      .set('Cookie', cookieEditor)
      .field('titulo', 'Contrato de obra')
      .field('expediente', 'EXP-100')
      .field('serieId', String(subserie))
      .field('fechaDocumento', '2026-03-02')
      .attach('archivo', contenido, { filename: nombre, contentType: 'application/pdf' })
      .expect(201);
    return body.documento.id as number;
  }

  function subirVersion(
    id: number,
    cookie: string,
    archivo: Buffer | null,
    motivo?: string,
    nombre = 'contrato.pdf',
  ) {
    let peticion = http().post(`/documentos/${id}/versiones`).set('Cookie', cookie);
    if (motivo !== undefined) peticion = peticion.field('motivo', motivo);
    if (archivo) {
      peticion = peticion.attach('archivo', archivo, { filename: nombre, contentType: 'application/pdf' });
    }
    return peticion;
  }

  const restaurar = (id: number, n: number, cookie: string, cuerpo: object = {}) =>
    http().post(`/documentos/${id}/versiones/${n}/restaurar`).set('Cookie', cookie).send(cuerpo);

  const historial = async (id: number): Promise<VersionJson[]> =>
    (await http().get(`/documentos/${id}/versiones`).set('Cookie', cookieLector).expect(200)).body;

  const objetos = async () => (await ctx.almacen.listar('documentos/')).map((o) => o.clave);

  describe('nueva versión', () => {
    it('agrega la versión 2 con su autor, fecha y motivo, y la deja vigente', async () => {
      const id = await crearDocumento();
      const { body } = await subirVersion(id, cookieEditor, v2, 'Se corrigió el valor del contrato').expect(201);
      expect(body).toMatchObject({
        numero: 2,
        sha256: sha256(v2),
        tamano: v2.length,
        motivo: 'Se corrigió el valor del contrato',
        restauradaDe: null,
        autor: 'editor',
      });
      expect(Number.isNaN(Date.parse(body.creadoEn))).toBe(false);

      const lista = await historial(id);
      expect(lista.map((v) => v.numero)).toEqual([2, 1]);
      expect((await http().get('/documentos').set('Cookie', cookieLector)).body.items[0].versionActual).toBe(2);
      expect((await ctx.almacen.leer(claveDeObjeto(sha256(v2)))).equals(v2)).toBe(true);
    });

    it('deja los eventos `version` en la auditoría', async () => {
      const id = await crearDocumento();
      await subirVersion(id, cookieAdmin, v2, 'Cambio').expect(201);
      const registrados = await eventos(ctx.pool, 'version');
      expect(registrados).toHaveLength(1);
      expect(registrados[0].detalle).toMatch(/^versión 2;/);
    });

    it('el historial lo ve cualquier rol y el detalle del documento trae lo mismo', async () => {
      const id = await crearDocumento();
      await subirVersion(id, cookieEditor, v2, 'Cambio').expect(201);
      const detalle = await http().get(`/documentos/${id}`).set('Cookie', cookieLector).expect(200);
      expect(detalle.body.versiones.map((v: VersionJson) => v.numero)).toEqual([2, 1]);
    });

    it('el motivo es obligatorio: sin motivo, vacío o de espacios → 400 y no se guarda nada', async () => {
      const id = await crearDocumento();
      for (const motivo of [undefined, '', '   ']) {
        const { body } = await subirVersion(id, cookieEditor, v2, motivo).expect(400);
        expect(body.problemas.join(' ')).toContain('motivo');
      }
      expect(await historial(id)).toHaveLength(1);
      expect(await ctx.almacen.existe(claveDeObjeto(sha256(v2)))).toBe(false);
    });

    it('un motivo de más de 300 caracteres → 400', async () => {
      const id = await crearDocumento();
      await subirVersion(id, cookieEditor, v2, 'x'.repeat(301)).expect(400);
    });

    it('sin archivo → 400', async () => {
      const id = await crearDocumento();
      await subirVersion(id, cookieEditor, null, 'Sin archivo').expect(400);
    });

    it('un archivo que no es PDF → 415 y no se guarda', async () => {
      const id = await crearDocumento();
      const texto = Buffer.from('texto plano');
      await subirVersion(id, cookieEditor, texto, 'No es PDF').expect(415);
      expect(await historial(id)).toHaveLength(1);
    });

    it('más de 20 MB → 413', async () => {
      const id = await crearDocumento();
      await subirVersion(id, cookieEditor, pdfDeTamano(21), 'Muy grande').expect(413);
      expect(await historial(id)).toHaveLength(1);
    }, 60000);

    it('un documento que no existe → 404 y no se sube el archivo', async () => {
      await subirVersion(99999, cookieEditor, v2, 'Nada').expect(404);
      expect(await ctx.almacen.existe(claveDeObjeto(sha256(v2)))).toBe(false);
    });

    it('el rol de consulta no puede versionar: 403 y queda registrado; sin sesión: 401', async () => {
      const id = await crearDocumento();
      await subirVersion(id, cookieLector, v2, 'Intento').expect(403);
      expect(await eventos(ctx.pool, 'acceso_denegado')).toHaveLength(1);
      expect(await historial(id)).toHaveLength(1);
      await http().post(`/documentos/${id}/versiones`).field('motivo', 'x').expect(401);
    });

    it('el motivo con tildes y eñes se guarda tal cual', async () => {
      const id = await crearDocumento();
      const motivo = 'Corrección de cláusula: garantía de un año, Ñandú';
      const { body } = await subirVersion(id, cookieEditor, v2, motivo).expect(201);
      expect(body.motivo).toBe(motivo);
      expect((await historial(id))[0].motivo).toBe(motivo);
    });

    it('las tildes del nombre del archivo se conservan', async () => {
      const id = await crearDocumento();
      const { body } = await subirVersion(id, cookieEditor, v2, 'Cambio', 'Interventoría año 2.pdf').expect(201);
      expect(body.nombreOriginal).toBe('Interventoría año 2.pdf');
    });
  });

  describe('la huella es única por documento, no global', () => {
    it('subir un archivo idéntico a una versión del mismo documento → 409 que dice cuál es', async () => {
      const id = await crearDocumento();
      const { body } = await subirVersion(id, cookieEditor, v1, 'Mismo archivo').expect(409);
      expect(body.versionExistente).toBe(1);
      expect(body.message).toMatch(/versión 1/);
      expect(await historial(id)).toHaveLength(1);
    });

    it('también si es idéntico a una versión que no es la vigente', async () => {
      const id = await crearDocumento();
      await subirVersion(id, cookieEditor, v2, 'Dos').expect(201);
      const { body } = await subirVersion(id, cookieEditor, v1, 'Volver a subir la uno').expect(409);
      expect(body.versionExistente).toBe(1);
    });

    it('una versión nueva no se compara con otros documentos: esa verificación es la de la carga (ADR-006)', async () => {
      const a = await crearDocumento();
      const b = await crearDocumento(otroV1, 'otro.pdf');
      await subirVersion(a, cookieEditor, v2, 'Dos en A').expect(201);
      await subirVersion(b, cookieEditor, v2, 'Dos en B').expect(201);
      expect((await historial(a))[0].sha256).toBe((await historial(b))[0].sha256);
    });

    it('un 409 no borra el objeto que otra versión usa', async () => {
      const id = await crearDocumento();
      await subirVersion(id, cookieEditor, v1, 'Repetido').expect(409);
      expect(await ctx.almacen.existe(claveDeObjeto(sha256(v1)))).toBe(true);
    });
  });

  describe('restauración', () => {
    it('restaurar la 1 crea la versión 3 con el contenido de la 1, sin tocar las anteriores', async () => {
      const id = await crearDocumento();
      await subirVersion(id, cookieEditor, v2, 'Dos').expect(201);
      const antes = await historial(id);
      const objetosAntes = await objetos();

      const { body } = await restaurar(id, 1, cookieEditor).expect(201);
      expect(body).toMatchObject({
        numero: 3,
        sha256: sha256(v1),
        tamano: v1.length,
        nombreOriginal: 'contrato-v1.pdf',
        motivo: 'Restaura la versión 1',
        restauradaDe: 1,
        autor: 'editor',
      });

      const despues = await historial(id);
      expect(despues.map((v) => v.numero)).toEqual([3, 2, 1]);
      // Las versiones 1 y 2 quedaron idénticas: se creó una nueva, no se editó ninguna.
      expect(despues.slice(1)).toEqual(antes);
      // No se copió el archivo: el almacén tiene los mismos objetos.
      expect(await objetos()).toEqual(objetosAntes);
    });

    it('descargar la versión restaurada entrega el archivo original', async () => {
      const id = await crearDocumento();
      await subirVersion(id, cookieEditor, v2, 'Dos').expect(201);
      await restaurar(id, 1, cookieEditor).expect(201);
      const respuesta = await http()
        .get(`/documentos/${id}/versiones/3/archivo`)
        .set('Cookie', cookieLector)
        .buffer(true)
        .parse((res, fin) => {
          const trozos: Buffer[] = [];
          res.on('data', (t: Buffer) => trozos.push(t));
          res.on('end', () => fin(null, Buffer.concat(trozos)));
        })
        .expect(200);
      expect((respuesta.body as Buffer).equals(v1)).toBe(true);
    });

    it('acepta un motivo propio', async () => {
      const id = await crearDocumento();
      await subirVersion(id, cookieEditor, v2, 'Dos').expect(201);
      const { body } = await restaurar(id, 1, cookieEditor, { motivo: 'El contratista objetó el cambio' }).expect(201);
      expect(body.motivo).toBe('El contratista objetó el cambio');
    });

    it('queda el evento `restauracion` en la auditoría', async () => {
      const id = await crearDocumento();
      await subirVersion(id, cookieEditor, v2, 'Dos').expect(201);
      await restaurar(id, 1, cookieAdmin).expect(201);
      const registrados = await eventos(ctx.pool, 'restauracion');
      expect(registrados).toHaveLength(1);
      expect(registrados[0].detalle).toBe('versión 1 restaurada como versión 3');
    });

    it('restaurar la versión vigente → 409', async () => {
      const id = await crearDocumento();
      const { body } = await restaurar(id, 1, cookieEditor).expect(409);
      expect(body.message).toMatch(/ya es la vigente/);
      expect(await historial(id)).toHaveLength(1);
    });

    it('restaurar algo cuyo contenido ya es el vigente → 409 (no se duplica el contenido)', async () => {
      const id = await crearDocumento();
      await subirVersion(id, cookieEditor, v2, 'Dos').expect(201);
      await restaurar(id, 1, cookieEditor).expect(201); // la 3 tiene el contenido de la 1
      const { body } = await restaurar(id, 1, cookieEditor).expect(409); // otra vez la 1: ya es la vigente
      expect(body.versionVigente).toBe(3);
      expect(await historial(id)).toHaveLength(3);
    });

    it('se puede restaurar una restauración y volver a restaurar una versión que ya se restauró antes', async () => {
      const id = await crearDocumento();
      await subirVersion(id, cookieEditor, v2, 'Dos').expect(201);
      await restaurar(id, 1, cookieEditor).expect(201); // 3 = contenido de 1
      await restaurar(id, 2, cookieEditor).expect(201); // 4 = contenido de 2
      const { body } = await restaurar(id, 1, cookieEditor).expect(201); // 5 = contenido de 1 otra vez
      expect(body).toMatchObject({ numero: 5, sha256: sha256(v1), restauradaDe: 1 });
      expect((await historial(id)).map((v) => v.numero)).toEqual([5, 4, 3, 2, 1]);
    });

    it('después de restaurar, subir como nuevo el contenido de la 1 sigue siendo 409', async () => {
      const id = await crearDocumento();
      await subirVersion(id, cookieEditor, v2, 'Dos').expect(201);
      await restaurar(id, 1, cookieEditor).expect(201);
      await subirVersion(id, cookieEditor, v1, 'Intento').expect(409);
    });

    it('una versión que no existe → 404; un documento que no existe → 404', async () => {
      const id = await crearDocumento();
      await restaurar(id, 9, cookieEditor).expect(404);
      await restaurar(99999, 1, cookieEditor).expect(404);
    });

    it('si el archivo de origen se perdió del almacén → 404 claro y no se crea nada', async () => {
      const id = await crearDocumento();
      await subirVersion(id, cookieEditor, v2, 'Dos').expect(201);
      await ctx.almacen.borrar(claveDeObjeto(sha256(v1)));
      const { body } = await restaurar(id, 1, cookieEditor).expect(404);
      expect(body.message).toMatch(/no está disponible/);
      expect(await historial(id)).toHaveLength(2);
    });

    it('el rol de consulta no restaura: 403; sin sesión: 401; motivo demasiado largo: 400', async () => {
      const id = await crearDocumento();
      await subirVersion(id, cookieEditor, v2, 'Dos').expect(201);
      await restaurar(id, 1, cookieLector).expect(403);
      await http().post(`/documentos/${id}/versiones/1/restaurar`).expect(401);
      await restaurar(id, 1, cookieEditor, { motivo: 'x'.repeat(301) }).expect(400);
      expect(await historial(id)).toHaveLength(2);
    });

    it('identificadores mal escritos → 400', async () => {
      await http().post('/documentos/abc/versiones/1/restaurar').set('Cookie', cookieEditor).expect(400);
      await http().post('/documentos/1/versiones/0/restaurar').set('Cookie', cookieEditor).expect(400);
    });
  });

  describe('numeración sin huecos ni repeticiones', () => {
    it('dos versiones simultáneas del mismo documento reciben números distintos y consecutivos', async () => {
      const id = await crearDocumento();
      const [a, b] = await Promise.all([
        subirVersion(id, cookieEditor, v2, 'Simultánea A'),
        subirVersion(id, cookieAdmin, v3, 'Simultánea B'),
      ]);
      expect([a.status, b.status]).toEqual([201, 201]);
      expect([a.body.numero, b.body.numero].sort((x, y) => x - y)).toEqual([2, 3]);
      expect((await historial(id)).map((v) => v.numero)).toEqual([3, 2, 1]);
    });

    it('la misma versión subida dos veces a la vez: una gana y la otra recibe 409', async () => {
      const id = await crearDocumento();
      const [a, b] = await Promise.all([
        subirVersion(id, cookieEditor, v2, 'Doble A'),
        subirVersion(id, cookieAdmin, v2, 'Doble B'),
      ]);
      expect([a.status, b.status].sort((x, y) => x - y), JSON.stringify([a.body, b.body])).toEqual([201, 409]);
      expect(await historial(id)).toHaveLength(2);
      expect(await ctx.almacen.existe(claveDeObjeto(sha256(v2)))).toBe(true);
    });

    it('dos restauraciones simultáneas de la misma versión: una gana y la otra recibe 409', async () => {
      const id = await crearDocumento();
      await subirVersion(id, cookieEditor, v2, 'Dos').expect(201);
      const [a, b] = await Promise.all([restaurar(id, 1, cookieEditor), restaurar(id, 1, cookieAdmin)]);
      expect([a.status, b.status].sort((x, y) => x - y)).toEqual([201, 409]);
      expect((await historial(id)).map((v) => v.numero)).toEqual([3, 2, 1]);
    });

    it('una versión que falla no deja huecos: la siguiente toma el número libre', async () => {
      const id = await crearDocumento();
      await subirVersion(id, cookieEditor, v1, 'Repetida').expect(409);
      const { body } = await subirVersion(id, cookieEditor, v2, 'Buena').expect(201);
      expect(body.numero).toBe(2);
    });
  });

  describe('restricciones de la base de datos', () => {
    const insertar = (documentoId: number, numero: number, sha: string, restauradaDe: number | null) =>
      ctx.pool.query(
        `insert into versiones (documento_id, numero, archivo, nombre_original, sha256, tamano, motivo, restaurada_de, autor_id)
         values ($1, $2, 'documentos/x.pdf', 'x.pdf', $3, 1, 'prueba', $4, (select id from usuarios where usuario = 'editor'))`,
        [documentoId, numero, sha, restauradaDe],
      );

    it('rechaza una huella repetida en el mismo documento si no es una restauración', async () => {
      const id = await crearDocumento();
      await expect(insertar(id, 2, sha256(v1), null)).rejects.toThrow(/versiones_documento_sha256_uq/);
    });

    it('acepta la huella repetida si es una restauración', async () => {
      const id = await crearDocumento();
      await expect(insertar(id, 2, sha256(v1), 1)).resolves.toBeDefined();
    });

    it('una restauración debe apuntar a una versión que exista en el mismo documento', async () => {
      const id = await crearDocumento();
      await expect(insertar(id, 9, sha256(v1), 7)).rejects.toThrow(/versiones_restaurada_de_fk/);
      const otro = await crearDocumento(otroV1, 'otro.pdf');
      await subirVersion(otro, cookieEditor, v2, 'Dos en otro').expect(201);
      // La versión 2 existe en el otro documento, no en este.
      await expect(insertar(id, 3, sha256(v1), 2)).rejects.toThrow(/versiones_restaurada_de_fk/);
    });

    it('una restauración debe apuntar a una versión anterior', async () => {
      const id = await crearDocumento();
      await expect(insertar(id, 2, sha256(v1), 2)).rejects.toThrow(/versiones_restaurada_anterior_ck/);
      await expect(insertar(id, 2, sha256(v1), 3)).rejects.toThrow(/versiones_restaurada_anterior_ck/);
    });

    it('la base permite la misma huella en documentos distintos: la unicidad es por documento', async () => {
      await crearDocumento();
      const b = await crearDocumento(otroV1, 'otro.pdf');
      await expect(insertar(b, 2, sha256(v1), null)).resolves.toBeDefined();
    });
  });
});
