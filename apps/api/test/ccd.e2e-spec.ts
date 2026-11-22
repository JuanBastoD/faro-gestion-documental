import request from 'supertest';
import { SeriesService } from '../src/ccd/series.service.js';
import { CCD_DEMO, contarCcdDemo, sembrarCcdDemo } from '../src/semilla/ccd-demo.js';
import { crearApp, crearUsuario, ingresar, limpiarTablas, type AppDePrueba } from './ayudas.js';

interface SerieJson {
  id: number;
  codigo: string;
  nombre: string;
  subseries: Array<{ id: number; codigo: string; nombre: string }>;
}

describe('Cuadro de clasificación (contra PostgreSQL real)', () => {
  let ctx: AppDePrueba;
  let idEditor: number;

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
  });

  const http = () => request(ctx.app.getHttpServer());

  async function idDe(codigo: string): Promise<number> {
    const { rows } = await ctx.pool.query('select id from series_ccd where codigo = $1', [codigo]);
    return rows[0].id;
  }

  const insertarDocumento = async (serieId: number) =>
    ctx.pool.query(
      `insert into documentos (titulo, expediente, serie_id, fecha_documento, creado_por)
       values ('Acta de prueba', 'EXP-1', $1, '2026-11-01', $2)`,
      [serieId, idEditor],
    );

  describe('siembra', () => {
    it('crea el cuadro de demostración completo', async () => {
      const esperadas = CCD_DEMO.reduce((n, s) => n + 1 + s.subseries.length, 0);
      expect(await contarCcdDemo(ctx.db)).toBe(esperadas);
    });

    it('repetirla no duplica ni cambia los identificadores', async () => {
      const antes = await ctx.pool.query('select id, codigo from series_ccd order by id');
      await sembrarCcdDemo(ctx.db);
      await sembrarCcdDemo(ctx.db);
      const despues = await ctx.pool.query('select id, codigo from series_ccd order by id');
      expect(despues.rows).toEqual(antes.rows);
    });

    it('corrige el nombre de una serie existente sin moverla', async () => {
      await ctx.pool.query(`update series_ccd set nombre = 'Nombre viejo' where codigo = '100.1'`);
      const padreAntes = await ctx.pool.query(`select padre_id from series_ccd where codigo = '100.1'`);
      await sembrarCcdDemo(ctx.db);
      const { rows } = await ctx.pool.query(
        `select nombre, padre_id from series_ccd where codigo = '100.1'`,
      );
      expect(rows[0].nombre).toBe('Contratos de obra');
      expect(rows[0].padre_id).toBe(padreAntes.rows[0].padre_id);
    });
  });

  describe('GET /series', () => {
    it.each(['admin', 'editor', 'lector'])('%s ve el cuadro como árbol de dos niveles', async (usuario) => {
      const cookie = await ingresar(ctx.app, usuario);
      const { body } = await http().get('/series').set('Cookie', cookie).expect(200);
      const arbol = body as SerieJson[];
      expect(arbol.map((s) => s.codigo)).toEqual(['100', '200', '300', '400']);
      const contractual = arbol.find((s) => s.codigo === '100');
      expect(contractual?.subseries.map((s) => s.codigo)).toEqual(['100.1', '100.2']);
      expect(arbol.every((s) => s.subseries.every((x) => !('subseries' in x)))).toBe(true);
    });

    it('sin sesión responde 401', async () => {
      await http().get('/series').expect(401);
    });
  });

  describe('solo las subseries admiten documentos', () => {
    it('la base acepta un documento en una subserie', async () => {
      await expect(insertarDocumento(await idDe('100.1'))).resolves.toBeDefined();
    });

    it('la base rechaza un documento en una serie', async () => {
      await expect(insertarDocumento(await idDe('100'))).rejects.toThrow(
        /solo se asocian a subseries/,
      );
    });

    it('la base rechaza mover un documento a una serie', async () => {
      await insertarDocumento(await idDe('100.1'));
      const raiz = await idDe('200');
      await expect(
        ctx.pool.query('update documentos set serie_id = $1', [raiz]),
      ).rejects.toThrow(/solo se asocian a subseries/);
    });

    it('el servicio lo rechaza antes con un mensaje claro', async () => {
      const servicio = ctx.app.get(SeriesService);
      await expect(servicio.exigirSubserie(await idDe('100'))).rejects.toThrow(/es una serie/);
      await expect(servicio.exigirSubserie(await idDe('100.1'))).resolves.toBeUndefined();
    });

    it('una subserie con documentos no puede volver a ser serie', async () => {
      await insertarDocumento(await idDe('100.1'));
      await expect(
        ctx.pool.query(`update series_ccd set padre_id = null where codigo = '100.1'`),
      ).rejects.toThrow(/tiene documentos/);
    });

    it('una subserie sin documentos sí puede reubicarse como serie', async () => {
      await expect(
        ctx.pool.query(`update series_ccd set padre_id = null where codigo = '100.2'`),
      ).resolves.toBeDefined();
    });
  });

  describe('el cuadro tiene dos niveles', () => {
    it('no se puede colgar una subserie de otra subserie', async () => {
      const subserie = await idDe('100.1');
      await expect(
        ctx.pool.query(
          `insert into series_ccd (codigo, nombre, padre_id) values ('100.1.1', 'Tercer nivel', $1)`,
          [subserie],
        ),
      ).rejects.toThrow(/dos niveles/);
    });

    it('una serie con subseries no puede pasar a colgar de otra', async () => {
      const otra = await idDe('200');
      await expect(
        ctx.pool.query(`update series_ccd set padre_id = $1 where codigo = '100'`, [otra]),
      ).rejects.toThrow(/dos niveles/);
    });

    it('una serie nueva sin padre y una subserie nueva de una serie se aceptan', async () => {
      await ctx.pool.query(`insert into series_ccd (codigo, nombre) values ('500', 'Nueva serie')`);
      const nueva = await idDe('500');
      await expect(
        ctx.pool.query(
          `insert into series_ccd (codigo, nombre, padre_id) values ('500.1', 'Nueva subserie', $1)`,
          [nueva],
        ),
      ).resolves.toBeDefined();
    });
  });
});
