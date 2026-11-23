import request from 'supertest';
import { CARACTERES_INDEXADOS, DocumentosRepository } from '../src/documentos/documentos.repository.js';
import { sembrarCcdDemo } from '../src/semilla/ccd-demo.js';
import {
  crearApp,
  crearUsuario,
  ingresar,
  limpiarTablas,
  type AppDePrueba,
} from './ayudas.js';
import { palabrasFicticias, pdfConTexto, pdfSinTexto } from './pdfs.js';

interface Resumen {
  id: number;
  titulo: string;
  expediente: string;
  serieCodigo: string;
  versionActual: number;
}
interface Pagina {
  items: Resumen[];
  total: number;
  pagina: number;
  tamano: number;
}

describe('Búsqueda por texto completo con paginación (contra PostgreSQL real)', () => {
  let ctx: AppDePrueba;
  let cookieEditor: string;
  let cookieLector: string;
  let subserieA: number; // 100.1
  let subserieB: number; // otra subserie de OTRA serie
  let serieDeA: number; // la serie padre de subserieA

  beforeAll(async () => {
    ctx = await crearApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await limpiarTablas(ctx.pool);
    for (const objeto of await ctx.almacen.listar('documentos/')) await ctx.almacen.borrar(objeto.clave);
    await crearUsuario(ctx.db, { usuario: 'editor', rol: 'editor' });
    await crearUsuario(ctx.db, { usuario: 'lector', rol: 'consulta' });
    await sembrarCcdDemo(ctx.db);
    const { rows } = await ctx.pool.query(
      `select s.id, s.codigo, s.padre_id from series_ccd s where s.padre_id is not null order by s.codigo`,
    );
    subserieA = rows[0].id;
    serieDeA = rows[0].padre_id;
    subserieB = rows.find((r: { padre_id: number }) => r.padre_id !== serieDeA).id;
    cookieEditor = await ingresar(ctx.app, 'editor');
    cookieLector = await ingresar(ctx.app, 'lector');
  });

  const http = () => request(ctx.app.getHttpServer());

  /** Una semilla distinta por documento para que cada PDF tenga contenido propio. */
  let contador = 0;
  async function cargar(
    titulo: string,
    opciones: { palabras?: string[]; pdf?: Buffer; expediente?: string; serieId?: number } = {},
  ): Promise<number> {
    const pdf = opciones.pdf ?? (await pdfConTexto(opciones.palabras ?? palabrasFicticias(300, 5000 + ++contador)));
    const { body } = await http()
      .post('/documentos')
      .set('Cookie', cookieEditor)
      .field('titulo', titulo)
      .field('expediente', opciones.expediente ?? 'EXP-001')
      .field('serieId', String(opciones.serieId ?? subserieA))
      .field('fechaDocumento', '2026-03-02')
      .attach('archivo', pdf, { filename: 'doc.pdf', contentType: 'application/pdf' })
      .expect(201);
    return body.documento.id as number;
  }

  const buscar = async (consulta: Record<string, string | number>, cookie = cookieLector): Promise<Pagina> =>
    (await http().get('/documentos').query(consulta).set('Cookie', cookie).expect(200)).body;
  const titulos = (p: Pagina) => p.items.map((i) => i.titulo);

  describe('qué encuentra', () => {
    it('sin tildes ni mayúsculas: «interventoria» encuentra «Interventoría»', async () => {
      await cargar('Informe de Interventoría del lote 2');
      await cargar('Acta de inicio');
      for (const q of ['interventoria', 'INTERVENTORIA', 'Interventoría', 'interventoría', '  interventoria  ']) {
        expect(titulos(await buscar({ q })), q).toEqual(['Informe de Interventoría del lote 2']);
      }
    });

    it('al revés: una consulta con tilde encuentra un título escrito sin ella', async () => {
      await cargar('Acta de liquidacion final');
      expect(titulos(await buscar({ q: 'liquidación' }))).toEqual(['Acta de liquidacion final']);
    });

    it('la eñe también: «ano» y «año» son la misma palabra para la búsqueda', async () => {
      await cargar('Informe del año fiscal');
      expect(titulos(await buscar({ q: 'ano' }))).toEqual(['Informe del año fiscal']);
      expect(titulos(await buscar({ q: 'año' }))).toEqual(['Informe del año fiscal']);
    });

    it('encuentra por expediente', async () => {
      await cargar('Un contrato', { expediente: 'EXP-ZETA-77' });
      await cargar('Otro contrato', { expediente: 'EXP-OMEGA-10' });
      expect(titulos(await buscar({ q: 'zeta' }))).toEqual(['Un contrato']);
    });

    it('encuentra por el texto del PDF, que no aparece en el título', async () => {
      const raro = 'zumbilicuaro';
      await cargar('Documento A', { palabras: [...palabrasFicticias(200, 11), raro, ...palabrasFicticias(200, 12)] });
      await cargar('Documento B', { palabras: palabrasFicticias(400, 13) });
      expect(titulos(await buscar({ q: raro }))).toEqual(['Documento A']);
      expect((await buscar({ q: 'palabraquenoestaenningundocumento' })).total).toBe(0);
    });

    it('con varias palabras exige todas (Y)', async () => {
      // Palabras que el generador de texto ficticio no puede producir, para que el cuerpo de los PDF no las contenga.
      await cargar('Convenio de pavimentación vial');
      await cargar('Convenio de consultoría');
      await cargar('Pavimentación de arte');
      expect(titulos(await buscar({ q: 'convenio pavimentacion' }))).toEqual(['Convenio de pavimentación vial']);
      expect((await buscar({ q: 'convenio' })).total).toBe(2);
    });

    it('encuentra variantes de la misma palabra (singular, plural y conjugaciones, con la raíz del español)', async () => {
      await cargar('Informe de interventorías');
      await cargar('Acta de pagos parciales');
      expect(titulos(await buscar({ q: 'interventoria' }))).toEqual(['Informe de interventorías']);
      expect(titulos(await buscar({ q: 'pago parcial' }))).toEqual(['Acta de pagos parciales']);
    });

    it('un documento sin capa de texto se encuentra por título y expediente', async () => {
      await cargar('Plano escaneado de la vía', { pdf: await pdfSinTexto(), expediente: 'EXP-VIA-9' });
      expect(titulos(await buscar({ q: 'plano' }))).toHaveLength(1);
      expect(titulos(await buscar({ q: 'via' }))).toHaveLength(1);
    });
  });

  describe('orden por relevancia', () => {
    it('una coincidencia en el título pesa más que una en el texto', async () => {
      const porTexto = await cargar('Documento sin la palabra', {
        palabras: [...palabrasFicticias(100, 21), 'cimentacion', ...palabrasFicticias(100, 22)],
      });
      const porTitulo = await cargar('Cimentación del puente', { palabras: palabrasFicticias(200, 23) });
      const { items } = await buscar({ q: 'cimentacion' });
      expect(items.map((i) => i.id)).toEqual([porTitulo, porTexto]);
    });

    it('a igual relevancia, el más reciente primero', async () => {
      const a = await cargar('Informe de avance');
      const b = await cargar('Informe de avance');
      const { items } = await buscar({ q: 'avance' });
      expect(items.map((i) => i.id)).toEqual([b, a]);
    });
  });

  describe('listado sin texto y filtro por serie', () => {
    it('sin q (o con q vacío, de espacios o solo signos) lista todo, el más reciente primero', async () => {
      const a = await cargar('Primero');
      const b = await cargar('Segundo');
      for (const consulta of [{}, { q: '' }, { q: '   ' }, { q: '---' }] as Array<Record<string, string | number>>) {
        const pagina = await buscar(consulta);
        expect(pagina.items.map((i) => i.id), JSON.stringify(consulta)).toEqual([b, a]);
        expect(pagina.total).toBe(2);
      }
    });

    it('una consulta de solo palabras vacías (de, la…) no encuentra nada y no falla', async () => {
      await cargar('Informe de la obra');
      const pagina = await buscar({ q: 'de la' });
      expect(pagina).toMatchObject({ total: 0, items: [] });
    });

    it('filtra por subserie y por serie (incluye sus subseries)', async () => {
      await cargar('En A', { serieId: subserieA });
      await cargar('En B', { serieId: subserieB });
      expect(titulos(await buscar({ serieId: subserieA }))).toEqual(['En A']);
      expect(titulos(await buscar({ serieId: subserieB }))).toEqual(['En B']);
      // La serie padre de A incluye los documentos de sus subseries, pero no los de otra serie.
      expect(titulos(await buscar({ serieId: serieDeA }))).toEqual(['En A']);
    });

    it('combina texto y serie', async () => {
      await cargar('Contrato en A', { serieId: subserieA });
      await cargar('Contrato en B', { serieId: subserieB });
      expect(titulos(await buscar({ q: 'contrato', serieId: subserieB }))).toEqual(['Contrato en B']);
      expect((await buscar({ q: 'contrato' })).total).toBe(2);
    });

    it('una serie que no existe da una lista vacía, no un error', async () => {
      await cargar('Algo');
      expect(await buscar({ serieId: 99999 })).toMatchObject({ total: 0, items: [] });
    });
  });

  describe('paginación', () => {
    it('no repite ni pierde elementos, con y sin texto, y el total es el de toda la búsqueda', async () => {
      const ids: number[] = [];
      for (let i = 0; i < 23; i++) ids.push(await cargar(`Informe ${i} de seguimiento`));

      for (const consulta of [{}, { q: 'seguimiento' }] as Array<Record<string, string | number>>) {
        const vistos: number[] = [];
        for (const pagina of [1, 2, 3, 4]) {
          const p = await buscar({ ...consulta, pagina, tamano: 10 });
          expect(p).toMatchObject({ total: 23, pagina, tamano: 10 });
          vistos.push(...p.items.map((i) => i.id));
        }
        expect(vistos, JSON.stringify(consulta)).toHaveLength(23);
        expect(new Set(vistos).size).toBe(23);
        expect([...vistos].sort((x, y) => x - y)).toEqual([...ids].sort((x, y) => x - y));
      }
    });

    it('una página más allá del final queda vacía pero conserva el total', async () => {
      await cargar('Único');
      expect(await buscar({ pagina: 5, tamano: 10 })).toMatchObject({ items: [], total: 1, pagina: 5 });
    });

    it('el tamaño máximo es 50 y los parámetros mal escritos dan 400', async () => {
      const cookie = cookieLector;
      await http().get('/documentos').query({ tamano: 51 }).set('Cookie', cookie).expect(400);
      await http().get('/documentos').query({ tamano: 0 }).set('Cookie', cookie).expect(400);
      await http().get('/documentos').query({ pagina: 0 }).set('Cookie', cookie).expect(400);
      await http().get('/documentos').query({ serieId: 'abc' }).set('Cookie', cookie).expect(400);
      await http().get('/documentos').query({ serieId: 0 }).set('Cookie', cookie).expect(400);
      await http().get('/documentos').query({ q: 'x'.repeat(201) }).set('Cookie', cookie).expect(400);
      await http().get('/documentos').query({ q: ['a', 'b'] }).set('Cookie', cookie).expect(400);
      expect((await buscar({ tamano: 50 })).tamano).toBe(50);
    });
  });

  describe('el índice sigue a la versión vigente', () => {
    const subirVersion = (id: number, palabras: string[], motivo: string) =>
      pdfConTexto(palabras).then((pdf) =>
        http()
          .post(`/documentos/${id}/versiones`)
          .set('Cookie', cookieEditor)
          .field('motivo', motivo)
          .attach('archivo', pdf, { filename: 'v.pdf', contentType: 'application/pdf' }),
      );

    it('una versión nueva reemplaza el texto buscable de la anterior', async () => {
      const id = await cargar('Contrato vivo', { palabras: [...palabrasFicticias(200, 31), 'alfarero', ...palabrasFicticias(100, 32)] });
      expect(titulos(await buscar({ q: 'alfarero' }))).toEqual(['Contrato vivo']);

      await subirVersion(id, [...palabrasFicticias(200, 33), 'ceramista', ...palabrasFicticias(100, 34)], 'Cambio de texto').then((r) => expect(r.status).toBe(201));
      expect((await buscar({ q: 'alfarero' })).total).toBe(0);
      expect(titulos(await buscar({ q: 'ceramista' }))).toEqual(['Contrato vivo']);
    });

    it('restaurar una versión devuelve su texto al índice', async () => {
      const id = await cargar('Contrato restaurable', { palabras: [...palabrasFicticias(200, 41), 'alfarero', ...palabrasFicticias(100, 42)] });
      await subirVersion(id, [...palabrasFicticias(200, 43), 'ceramista', ...palabrasFicticias(100, 44)], 'Cambio').then((r) => expect(r.status).toBe(201));
      expect((await buscar({ q: 'alfarero' })).total).toBe(0);

      await http().post(`/documentos/${id}/versiones/1/restaurar`).set('Cookie', cookieEditor).send({}).expect(201);
      expect(titulos(await buscar({ q: 'alfarero' }))).toEqual(['Contrato restaurable']);
      expect((await buscar({ q: 'ceramista' })).total).toBe(0);
    });

    it('si la versión vigente no tiene texto, se sigue encontrando por título', async () => {
      const id = await cargar('Contrato que se vuelve imagen', { palabras: [...palabrasFicticias(200, 51), 'alfarero'] });
      const sinTexto = await pdfSinTexto({ productor: 'Otro escáner' });
      await http()
        .post(`/documentos/${id}/versiones`)
        .set('Cookie', cookieEditor)
        .field('motivo', 'Ahora solo la imagen')
        .attach('archivo', sinTexto, { filename: 'v.pdf', contentType: 'application/pdf' })
        .expect(201);
      expect((await buscar({ q: 'alfarero' })).total).toBe(0);
      expect(titulos(await buscar({ q: 'imagen' }))).toEqual(['Contrato que se vuelve imagen']);
    });
  });

  describe('seguridad y límites', () => {
    it('cualquier rol con sesión busca; sin sesión, 401', async () => {
      await cargar('Informe público interno');
      expect((await buscar({ q: 'informe' }, cookieLector)).total).toBe(1);
      expect((await buscar({ q: 'informe' }, cookieEditor)).total).toBe(1);
      await http().get('/documentos').query({ q: 'informe' }).expect(401);
    });

    it('lo escrito en q es solo texto: comillas, operadores de tsquery y SQL no rompen nada', async () => {
      await cargar('Contrato de obra');
      for (const q of ["'; drop table documentos; --", 'obra & | ! ( )', '"contrato"', 'obra:*', '\\', 'a'.repeat(200), 'ñandú 0 1 2 --- ///']) {
        const respuesta = await http().get('/documentos').query({ q }).set('Cookie', cookieLector);
        expect(respuesta.status, q).toBe(200);
      }
      expect((await ctx.pool.query('select count(*)::int as n from documentos')).rows[0].n).toBe(1);
    });

    it('un texto enorme no rompe la carga: el índice toma solo los primeros caracteres', async () => {
      // Un texto de 1,5 millones de caracteres donde casi toda palabra es distinta (el peor caso de un OCR con mucho ruido).
      const id = await cargar('Documento enorme', { palabras: palabrasFicticias(300, 61) });
      const enorme = Array.from({ length: 150_000 }, (_, i) => `palabra${i}x${(i * 7919) % 100003}`).join(' ');
      expect(enorme.length).toBeGreaterThan(CARACTERES_INDEXADOS * 4);
      await ctx.pool.query(`update versiones set texto_normalizado = $1 where documento_id = $2`, [enorme, id]);

      const repositorio = ctx.app.get(DocumentosRepository);
      await repositorio.enTransaccion((tx) => repositorio.actualizarBusqueda(tx, id));

      // Una palabra del principio entra al índice; una del final, no.
      expect((await buscar({ q: 'palabra10x79190' })).total).toBe(1);
      expect((await buscar({ q: 'palabra149999x' + ((149999 * 7919) % 100003) })).total).toBe(0);
      // El título sigue encontrándose.
      expect(titulos(await buscar({ q: 'enorme' }))).toEqual(['Documento enorme']);
    }, 60000);
  });
});
