import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { DB, POOL, type BaseDatos } from '../src/base-datos/base-datos.module.js';
import { migrar } from '../src/base-datos/migrar.js';
import type pg from 'pg';

/**
 * Arranque real contra PostgreSQL: en local el de `npm run infra:up`,
 * en CI un servicio. Si falla con "ECONNREFUSED", falta levantar la infraestructura.
 */
describe('API contra PostgreSQL real', () => {
  let app: INestApplication;
  let pool: pg.Pool;
  let db: BaseDatos;

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = modulo.createNestApplication();
    await app.init();
    pool = app.get<pg.Pool>(POOL);
    db = app.get<BaseDatos>(DB);
    await migrar(db);
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health responde 200 con la API y la base en ok', async () => {
    const respuesta = await request(app.getHttpServer()).get('/health').expect(200);
    expect(respuesta.body.estado).toBe('ok');
    expect(respuesta.body.api).toMatchObject({ estado: 'ok' });
    expect(respuesta.body.api.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(respuesta.body.base.estado).toBe('ok');
    expect(typeof respuesta.body.base.latenciaMs).toBe('number');
  });

  it('la migración inicial creó las tablas del esquema', async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public'`,
    );
    const tablas = rows.map((fila) => fila.table_name);
    expect(tablas).toEqual(
      expect.arrayContaining(['usuarios', 'series_ccd', 'documentos', 'versiones', 'auditoria']),
    );
  });

  it('la huella SHA-256 es única por documento (no global) y las restauraciones quedan fuera', async () => {
    const { rows: indices } = await pool.query<{ indexdef: string }>(
      `select indexdef from pg_indexes where tablename = 'versiones' and indexname = 'versiones_documento_sha256_uq'`,
    );
    expect(indices).toHaveLength(1);
    expect(indices[0].indexdef).toMatch(
      /UNIQUE INDEX .* \(documento_id, sha256\) WHERE \(restaurada_de IS NULL\)/,
    );
    // Y no hay una restricción única global sobre la huella.
    const { rows: restricciones } = await pool.query<{ conname: string }>(
      `select conname from pg_constraint where conrelid = 'versiones'::regclass and contype = 'u'`,
    );
    expect(restricciones.map((fila) => fila.conname)).not.toContain('versiones_sha256_unique');
  });

  it('aplicar las migraciones otra vez no falla ni duplica nada', async () => {
    await expect(migrar(db)).resolves.toBeUndefined();
  });

  it('GET /health responde 503 si la base no contesta', async () => {
    const baseCaida = {
      query: async () => {
        throw new Error('base caída');
      },
      end: async () => {},
      on: () => baseCaida,
    };
    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(POOL)
      .useValue(baseCaida)
      .compile();
    const appCaida = modulo.createNestApplication();
    await appCaida.init();
    try {
      const respuesta = await request(appCaida.getHttpServer()).get('/health').expect(503);
      expect(respuesta.body.estado).toBe('degradado');
      expect(respuesta.body.api.estado).toBe('ok');
      expect(respuesta.body.base).toEqual({ estado: 'error' });
    } finally {
      await appCaida.close();
    }
  });
});
