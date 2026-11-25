import { inspect } from 'node:util';
import {
  BadRequestException,
  ForbiddenException,
  IntrinsicException,
  Logger,
  type ArgumentsHost,
  type HttpServer,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { FiltroDeExcepciones, resumirError } from './filtro-excepciones.js';

// Valores ficticios con la forma de un hash de clave: lo que no puede aparecer en el registro.
const HASH_NUEVO_FALSO = '$argon2id$v=19$m=65536,t=3,p=4$SALNUEVA$HASHNUEVOFALSO';
const HASH_VERIFICADO_FALSO = '$argon2id$v=19$m=65536,t=3,p=4$SALVIEJA$HASHVERIFICADOFALSO';
const TEXTO_LANZADO = 'texto-confidencial-lanzado-con-throw';

interface Respuesta {
  cuerpo: unknown;
  estado: number;
}

/** Un servidor HTTP de mentira que anota lo que Nest respondería. */
function crearServidor(cabecerasEnviadas = false) {
  const respuestas: Respuesta[] = [];
  let terminadas = 0;
  const servidor = {
    reply: (_respuesta: unknown, cuerpo: unknown, estado: number) => void respuestas.push({ cuerpo, estado }),
    isHeadersSent: () => cabecerasEnviadas,
    end: () => void terminadas++,
  } as unknown as HttpServer;
  return { servidor, respuestas, terminadas: () => terminadas };
}

const host = { getArgByIndex: (posicion: number) => (posicion === 1 ? { respuesta: true } : { peticion: true }) } as unknown as ArgumentsHost;

/** Error de consulta de Drizzle como el que lanza una actualización de la clave: con `params` y una causa de `pg`. */
function errorDeConsulta(): DrizzleQueryError {
  const causa = Object.assign(new Error(`invalid input syntax for type integer: "${HASH_NUEVO_FALSO}"`), {
    code: '22P02',
  });
  return new DrizzleQueryError(
    'update "usuarios" set "clave_hash" = $1 where "usuarios"."clave_hash" = $2',
    [HASH_NUEVO_FALSO, HASH_VERIFICADO_FALSO],
    causa,
  );
}

describe('FiltroDeExcepciones (H-02: el registro no lleva los parámetros de la consulta)', () => {
  const espia = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

  beforeEach(() => {
    espia.mockClear();
  });
  afterAll(() => {
    espia.mockRestore();
  });

  /**
   * Todo lo que se escribió con `Logger.error`, como lo escribe Nest: un `Error` pasa por `util.inspect`, que
   * imprime la pila y también las propiedades propias (`query`, `params`) y la causa del error.
   */
  function registrado(): string {
    return espia.mock.calls
      .map(([mensaje]) => (mensaje instanceof Error ? inspect(mensaje, { depth: 6 }) : String(mensaje)))
      .join('\n');
  }

  function conFiltro(excepcion: unknown, enviadas = false) {
    const { servidor, respuestas, terminadas } = crearServidor(enviadas);
    new FiltroDeExcepciones(servidor).catch(excepcion, host);
    return { respuestas, terminadas: terminadas(), registro: registrado(), llamadas: espia.mock.calls.length };
  }

  function conFiltroDeNest(excepcion: unknown, enviadas = false) {
    espia.mockClear();
    const { servidor, respuestas, terminadas } = crearServidor(enviadas);
    new BaseExceptionFilter(servidor).catch(excepcion, host);
    return { respuestas, terminadas: terminadas(), registro: registrado(), llamadas: espia.mock.calls.length };
  }

  describe('un fallo de consulta de Drizzle', () => {
    it('el filtro por defecto de Nest escribe los parámetros (la premisa del problema)', () => {
      const { registro } = conFiltroDeNest(errorDeConsulta());
      expect(registro).toContain('HASHNUEVOFALSO');
      expect(registro).toContain('HASHVERIFICADOFALSO');
    });

    it('no escribe ningún hash: ni el nuevo, ni el verificado, ni `params:`, ni el mensaje de la causa', () => {
      const { registro } = conFiltro(errorDeConsulta());
      expect(registro).not.toContain('HASHNUEVOFALSO');
      expect(registro).not.toContain('HASHVERIFICADOFALSO');
      expect(registro).not.toContain('argon2');
      expect(registro).not.toContain('params');
      expect(registro).not.toContain('invalid input syntax');
    });

    it('sí escribe lo necesario para diagnosticar: clase, primera línea (la consulta sin valores), código de pg y la pila', () => {
      const { registro, llamadas } = conFiltro(errorDeConsulta());
      expect(llamadas).toBe(1);
      // La primera línea sigue diciendo la clase original, no un nombre propio del filtro.
      expect(registro.split('\n')[0]).toBe(
        'DrizzleQueryError: Failed query: update "usuarios" set "clave_hash" = $1 where "usuarios"."clave_hash" = $2 (código 22P02)',
      );
      // Y no arrastra propiedades ni causa: es un objeto sin nada más que el mensaje y la pila.
      expect(registro).not.toContain('cause');
      expect(registro).not.toMatch(/(^|\n)\s*[{,]?\s*(query|params):/);
      // La pila del original se conserva (rutas y líneas, sin valores) para ubicar el fallo.
      expect(registro).toMatch(/\n\s+at .*filtro-excepciones\.spec/);
    });

    it('responde 500 genérico, igual que Nest', () => {
      const { respuestas } = conFiltro(errorDeConsulta());
      expect(respuestas).toEqual([{ cuerpo: { statusCode: 500, message: 'Internal server error' }, estado: 500 }]);
    });
  });

  describe('la respuesta es exactamente la de Nest, para cualquier cosa que se lance', () => {
    const casos: Array<[string, () => unknown]> = [
      ['fallo de consulta de Drizzle', errorDeConsulta],
      ['Error común', () => new Error('algo salió mal')],
      ['TypeError', () => new TypeError('x es undefined')],
      ['texto lanzado con throw', () => TEXTO_LANZADO],
      ['objeto lanzado con throw', () => ({ clave: TEXTO_LANZADO })],
      ['null', () => null],
      ['undefined', () => undefined],
      ['error con forma HTTP (4xx de un middleware)', () => Object.assign(new Error('request entity too large'), { status: 413, statusCode: 413, expose: true })],
      ['error con forma HTTP que no se expone', () => Object.assign(new Error('detalle interno'), { status: 500, statusCode: 500, expose: false })],
      ['HttpException con cuerpo propio', () => new ForbiddenException({ statusCode: 403, codigo: 'cambio_de_clave_requerido', message: 'x' })],
      ['HttpException con texto', () => new BadRequestException('mensaje')],
      ['IntrinsicException', () => new IntrinsicException('no se registra')],
    ];

    it.each(casos)('%s', (_nombre, crear) => {
      const excepcion = crear();
      const propia = conFiltro(excepcion);
      const deNest = conFiltroDeNest(excepcion);
      expect(propia.respuestas).toEqual(deNest.respuestas);
      expect(propia.respuestas).toHaveLength(1);
      expect(propia.terminadas).toBe(deNest.terminadas);
      // Se registra lo mismo que antes en cantidad: nada que Nest no registrara, y todo lo que registraba.
      expect(propia.llamadas).toBe(deNest.llamadas);
    });

    it('los errores inesperados responden 500 con el mensaje genérico', () => {
      for (const excepcion of [errorDeConsulta(), new Error('x'), TEXTO_LANZADO, null, undefined]) {
        expect(conFiltro(excepcion).respuestas).toEqual([
          { cuerpo: { statusCode: 500, message: 'Internal server error' }, estado: 500 },
        ]);
      }
    });

    it('si la respuesta ya empezó a enviarse, la termina en vez de responder otra vez (como Nest)', () => {
      const propia = conFiltro(new Error('tarde'), true);
      const deNest = conFiltroDeNest(new Error('tarde'), true);
      expect(propia.respuestas).toEqual([]);
      expect(propia.terminadas).toBe(1);
      expect(deNest.terminadas).toBe(1);
    });
  });

  describe('lo que no es un 500 inesperado queda como estaba', () => {
    it('una HttpException no se registra', () => {
      expect(conFiltro(new ForbiddenException()).llamadas).toBe(0);
    });

    it('una IntrinsicException no se registra', () => {
      expect(conFiltro(new IntrinsicException('x')).llamadas).toBe(0);
    });

    it('un error con forma HTTP se registra tal cual, con el mismo objeto (su mensaje ya viaja al cliente)', () => {
      const error = Object.assign(new Error('request entity too large'), { status: 413, statusCode: 413, expose: true });
      conFiltro(error);
      expect(espia.mock.calls).toHaveLength(1);
      expect(espia.mock.calls[0]?.[0]).toBe(error);
    });
  });

  describe('lo lanzado que no es un Error', () => {
    it('no se escribe: solo de qué tipo era', () => {
      for (const valor of [TEXTO_LANZADO, { clave: TEXTO_LANZADO }]) {
        espia.mockClear();
        const { registro } = conFiltro(valor);
        expect(registro).not.toContain(TEXTO_LANZADO);
        expect(registro).toContain('lo lanzado no era un Error');
      }
    });
  });
});

describe('resumirError', () => {
  it('conserva solo la primera línea del mensaje', () => {
    const resumen = resumirError(new Error('primera línea\nparams: segunda\ntercera'));
    expect(resumen.resumen).toBe('primera línea');
    expect(JSON.stringify(resumen)).not.toContain('segunda');
  });

  it('corta una primera línea muy larga', () => {
    const { resumen } = resumirError(new Error('a'.repeat(5000)));
    expect(resumen.length).toBeLessThanOrEqual(501);
    expect(resumen.endsWith('…')).toBe(true);
  });

  it('toma la clase y el `code` del error y de su causa, sin repetir y sin el mensaje de la causa', () => {
    const causa = Object.assign(new Error('deadlock detected: valor-de-la-causa'), { code: '40P01' });
    const resumen = resumirError(Object.assign(new Error('falló', { cause: causa }), { code: 'E_PROPIO' }));
    expect(resumen.clase).toBe('Error');
    expect(resumen.codigos).toEqual(['E_PROPIO', '40P01']);
    expect(JSON.stringify(resumen)).not.toContain('valor-de-la-causa');

    expect(resumirError(Object.assign(new Error('x', { cause: Object.assign(new Error('y'), { code: 'IGUAL' }) }), { code: 'IGUAL' })).codigos).toEqual(['IGUAL']);
  });

  it('la clase de un fallo de Drizzle es DrizzleQueryError y su código es el de pg', () => {
    const resumen = resumirError(errorDeConsulta());
    expect(resumen.clase).toBe('DrizzleQueryError');
    expect(resumen.resumen).toBe('Failed query: update "usuarios" set "clave_hash" = $1 where "usuarios"."clave_hash" = $2');
    expect(resumen.codigos).toEqual(['22P02']);
  });

  it('lo que no es un Error devuelve solo el tipo', () => {
    expect(resumirError(TEXTO_LANZADO)).toEqual({ clase: 'string', resumen: '(lo lanzado no era un Error)', codigos: [] });
    expect(resumirError(undefined).clase).toBe('undefined');
  });
});
