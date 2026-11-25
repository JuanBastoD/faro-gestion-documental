/**
 * Revisión C3, H-02: un fallo de consulta de Drizzle trae en su mensaje `params: ...` (hashes de clave, por
 * ejemplo) y Nest lo escribía entero en el registro del servidor. El filtro global registra solo la clase, la
 * primera línea del mensaje y el código de PostgreSQL, y responde exactamente lo mismo que antes.
 *
 * Aquí el fallo es real: una consulta que PostgreSQL rechaza, con un valor con forma de hash como parámetro.
 */
import { Controller, Get, Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { Publico } from '../src/auth/decoradores.js';
import { DB, type BaseDatos } from '../src/base-datos/base-datos.module.js';
import { crearApp, type AppDePrueba } from './ayudas.js';

// Valor ficticio con la forma de un hash de clave: lo que no puede aparecer en el registro.
const HASH_FALSO = '$argon2id$v=19$m=65536,t=3,p=4$SALFALSA$HASHFALSODEPRUEBA';

/** Una ruta que existe solo en esta prueba y falla de verdad contra PostgreSQL. */
@Controller('prueba-fallo')
class ControladorQueFalla {
  constructor(@Inject(DB) private readonly db: BaseDatos) {}

  /** El texto no es un entero: PostgreSQL rechaza la consulta (22P02) y Drizzle lanza `DrizzleQueryError` con `params`. */
  @Publico()
  @Get('consulta')
  async consulta(): Promise<void> {
    await this.db.execute(sql`select ${HASH_FALSO}::integer`);
  }

  /** Un error que no es de la base, para comprobar que el 500 genérico no cambió. */
  @Publico()
  @Get('comun')
  comun(): void {
    throw new Error('fallo común sin datos');
  }
}

describe('El registro del servidor no lleva los parámetros de una consulta fallida (contra PostgreSQL real)', () => {
  let ctx: AppDePrueba;

  beforeAll(async () => {
    ctx = await crearApp([ControladorQueFalla]);
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  /** Lo que el servidor escribe por la salida de error mientras corre `peticion` (Nest registra los errores ahí). */
  async function conRegistro(peticion: () => Promise<request.Response>): Promise<{ respuesta: request.Response; registro: string }> {
    const escritos: string[] = [];
    const espia = vi.spyOn(process.stderr, 'write').mockImplementation((fragmento: string | Uint8Array) => {
      escritos.push(typeof fragmento === 'string' ? fragmento : Buffer.from(fragmento).toString('utf8'));
      return true;
    });
    try {
      const respuesta = await peticion();
      return { respuesta, registro: escritos.join('') };
    } finally {
      espia.mockRestore();
    }
  }

  const http = () => request(ctx.app.getHttpServer());

  it('un fallo de consulta responde 500 genérico y el registro no lleva el valor ni `params`', async () => {
    const { respuesta, registro } = await conRegistro(() => http().get('/prueba-fallo/consulta'));

    // La respuesta es la de siempre: 500 genérico, sin nada de la consulta.
    expect(respuesta.status).toBe(500);
    expect(respuesta.body).toEqual({ statusCode: 500, message: 'Internal server error' });
    expect(JSON.stringify(respuesta.body)).not.toContain('HASHFALSODEPRUEBA');

    // El error sí se registró (si no, la prueba no probaría nada) y con lo necesario para diagnosticarlo.
    expect(registro).toContain('DrizzleQueryError');
    expect(registro).toContain('Failed query: select $1::integer');
    expect(registro).toContain('22P02');
    // Y no lleva el valor: ni en `params:`, ni en el mensaje que PostgreSQL repite en la causa.
    expect(registro).not.toContain('HASHFALSODEPRUEBA');
    expect(registro).not.toContain('argon2');
    expect(registro).not.toContain('params');
    expect(registro).not.toContain('invalid input syntax');
  });

  it('un error común sigue siendo un 500 genérico y se registra', async () => {
    const { respuesta, registro } = await conRegistro(() => http().get('/prueba-fallo/comun'));
    expect(respuesta.status).toBe(500);
    expect(respuesta.body).toEqual({ statusCode: 500, message: 'Internal server error' });
    expect(registro).toContain('Error: fallo común sin datos');
  });

  it('las respuestas que no son un 500 inesperado siguen igual y no llenan el registro', async () => {
    const sinSesion = await conRegistro(() => http().get('/documentos'));
    expect(sinSesion.respuesta.status).toBe(401);
    expect(sinSesion.respuesta.body).toMatchObject({ statusCode: 401 });
    expect(sinSesion.registro).toBe('');

    const noExiste = await conRegistro(() => http().get('/ruta-que-no-existe'));
    expect(noExiste.respuesta.status).toBe(404);
    expect(noExiste.respuesta.body).toEqual({
      message: 'Cannot GET /ruta-que-no-existe',
      error: 'Not Found',
      statusCode: 404,
    });
    expect(noExiste.registro).toBe('');
  });

  it('un JSON mal formado sigue siendo un 400 (error con forma HTTP de un middleware, que no se toca)', async () => {
    const { respuesta } = await conRegistro(() =>
      http().post('/auth/login').set('Content-Type', 'application/json').send('{"usuario": "x", '),
    );
    expect(respuesta.status).toBe(400);
  });
});
