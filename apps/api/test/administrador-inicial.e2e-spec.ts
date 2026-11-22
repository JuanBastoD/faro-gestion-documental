import { BadRequestException } from '@nestjs/common';
import request from 'supertest';
import { crearAdministradorInicial } from '../src/semilla/administrador-inicial.js';
import { crearApp, limpiarTablas, type AppDePrueba } from './ayudas.js';

const CLAVE = 'primera-clave-larga-2026';

describe('Primer administrador (instalación nueva)', () => {
  let ctx: AppDePrueba;

  beforeAll(async () => {
    ctx = await crearApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await limpiarTablas(ctx.pool);
  });

  const usuarios = async () => (await ctx.pool.query('select * from usuarios order by id')).rows;

  it('crea un administrador activo con la clave en argon2id, y puede ingresar y administrar', async () => {
    expect(await crearAdministradorInicial(ctx.db, { usuario: 'admin.faro', nombre: 'Administrador Faro', clave: CLAVE })).toBe(true);
    const [fila] = await usuarios();
    expect(fila).toMatchObject({ usuario: 'admin.faro', nombre: 'Administrador Faro', rol: 'administrador', activo: true });
    expect(fila.clave_hash).toMatch(/^\$argon2id\$/);

    const ingreso = await request(ctx.app.getHttpServer()).post('/auth/login').send({ usuario: 'admin.faro', clave: CLAVE }).expect(200);
    const cookie = (ingreso.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');
    await request(ctx.app.getHttpServer()).get('/usuarios').set('Cookie', cookie).expect(200);
  });

  it('deja un evento de auditoría sin autor y sin la clave', async () => {
    await crearAdministradorInicial(ctx.db, { usuario: 'admin.faro', nombre: 'Admin', clave: CLAVE });
    const { rows } = await ctx.pool.query(`select usuario_id, accion, detalle from auditoria`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ usuario_id: null, accion: 'usuario_creado' });
    expect(rows[0].detalle).toContain('admin.faro');
    expect(JSON.stringify(rows)).not.toContain(CLAVE);
  });

  it('es seguro repetirlo: si el nombre ya existe no cambia nada (ni la clave ni el rol)', async () => {
    await crearAdministradorInicial(ctx.db, { usuario: 'admin.faro', nombre: 'Admin', clave: CLAVE });
    const antes = await usuarios();
    expect(await crearAdministradorInicial(ctx.db, { usuario: 'admin.faro', nombre: 'Otro', clave: 'otra-clave-distinta-99' })).toBe(false);
    expect(await usuarios()).toEqual(antes);
    expect((await ctx.pool.query('select count(*)::int as n from auditoria')).rows[0].n).toBe(1);
  });

  it.each([
    ['clave corta', { usuario: 'admin.faro', nombre: 'A', clave: 'corta' }],
    ['clave vacía (variable sin definir)', { usuario: 'admin.faro', nombre: 'A', clave: '' }],
    ['usuario con mayúsculas', { usuario: 'Admin', nombre: 'A', clave: CLAVE }],
    ['usuario vacío (variable sin definir)', { usuario: '', nombre: 'A', clave: CLAVE }],
  ])('%s: lo rechaza con las mismas reglas que POST /usuarios y no crea nada', async (_nombre, datos) => {
    const error = await crearAdministradorInicial(ctx.db, datos).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect(JSON.stringify((error as BadRequestException).getResponse())).not.toContain(CLAVE);
    expect(await usuarios()).toHaveLength(0);
  });
});
