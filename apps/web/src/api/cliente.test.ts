import { afterEach, describe, expect, it, vi } from 'vitest';
import { alExpirarLaSesion, ErrorApi, leerEspera, pedir } from './cliente';

function responder(cuerpo: BodyInit | null, estado: number, cabeceras: Record<string, string> = {}): Response {
  return new Response(cuerpo, { status: estado, headers: cabeceras });
}

function json(cuerpo: unknown, estado = 200, cabeceras: Record<string, string> = {}): Response {
  return responder(JSON.stringify(cuerpo), estado, { 'Content-Type': 'application/json', ...cabeceras });
}

/** Sustituye fetch y devuelve el espía para inspeccionar lo que se envió. */
function simularFetch(respuesta: Response | Error | DOMException) {
  const espia = vi.fn((_ruta: string, _init?: RequestInit) =>
    respuesta instanceof Response ? Promise.resolve(respuesta) : Promise.reject(respuesta),
  );
  vi.stubGlobal('fetch', espia);
  return espia;
}

async function fallo(promesa: Promise<unknown>): Promise<ErrorApi> {
  try {
    await promesa;
  } catch (error) {
    if (error instanceof ErrorApi) return error;
    throw error;
  }
  throw new Error('Se esperaba que la petición fallara');
}

describe('pedir', () => {
  describe('lo que envía', () => {
    it('usa GET, pide JSON y manda la cookie solo al mismo origen', async () => {
      const espia = simularFetch(json({ ok: true }));
      await pedir('/series');
      expect(espia).toHaveBeenCalledWith(
        '/series',
        expect.objectContaining({ method: 'GET', credentials: 'same-origin', headers: { Accept: 'application/json' } }),
      );
    });

    it('arma la cadena de consulta sin lo que está vacío, indefinido o nulo', async () => {
      const espia = simularFetch(json({}));
      await pedir('/documentos', { consulta: { q: 'interventoría', serieId: 12, pagina: 2, vacio: '', nada: undefined, nulo: null } });
      expect(espia.mock.calls[0]).toEqual([
        `/documentos?q=${encodeURIComponent('interventoría')}&serieId=12&pagina=2`,
        expect.anything(),
      ]);
    });

    it('sin parámetros útiles no agrega el signo de interrogación', async () => {
      const espia = simularFetch(json({}));
      await pedir('/documentos', { consulta: { q: '', serieId: undefined } });
      expect(espia.mock.calls[0][0]).toBe('/documentos');
    });

    it('envía el cuerpo como JSON con su Content-Type', async () => {
      const espia = simularFetch(json({ usuario: {} }));
      await pedir('/auth/login', { metodo: 'POST', cuerpo: { usuario: 'ana', clave: 'x' } });
      const [, init] = espia.mock.calls[0] as unknown as [string, RequestInit];
      expect(init.method).toBe('POST');
      expect(init.body).toBe('{"usuario":"ana","clave":"x"}');
      expect(init.headers).toEqual({ Accept: 'application/json', 'Content-Type': 'application/json' });
    });

    it('con un formulario no fija el Content-Type: el navegador pone el límite del multipart', async () => {
      const espia = simularFetch(json({}, 201));
      const formulario = new FormData();
      formulario.set('titulo', 'Acta');
      await pedir('/documentos', { metodo: 'POST', formulario });
      const [, init] = espia.mock.calls[0] as unknown as [string, RequestInit];
      expect(init.body).toBe(formulario);
      expect(init.headers).toEqual({ Accept: 'application/json' });
    });

    it('pasa la señal de cancelación a fetch', async () => {
      const espia = simularFetch(json({}));
      const control = new AbortController();
      await pedir('/series', { senal: control.signal });
      const [, init] = espia.mock.calls[0] as unknown as [string, RequestInit];
      expect(init.signal).toBe(control.signal);
    });
  });

  describe('lo que devuelve', () => {
    it('el cuerpo JSON ya convertido', async () => {
      simularFetch(json({ total: 3 }));
      await expect(pedir('/documentos')).resolves.toEqual({ total: 3 });
    });

    it('undefined cuando no hay cuerpo (204)', async () => {
      simularFetch(responder(null, 204));
      await expect(pedir('/auth/logout', { metodo: 'POST' })).resolves.toBeUndefined();
    });

    it('un ErrorApi si una respuesta correcta no es JSON', async () => {
      simularFetch(responder('<html>', 200));
      const error = await fallo(pedir('/series'));
      expect(error.message).toMatch(/formato esperado/);
    });
  });

  describe('errores de la API (cada formato real)', () => {
    it('Nest: statusCode, message y error', async () => {
      simularFetch(json({ statusCode: 404, message: 'No existe el documento 9', error: 'Not Found' }, 404));
      const error = await fallo(pedir('/documentos/9'));
      expect(error).toBeInstanceOf(ErrorApi);
      expect(error.estado).toBe(404);
      expect(error.message).toBe('No existe el documento 9');
      expect(error.codigo).toBeUndefined();
      expect(error.problemas).toEqual([]);
    });

    it('de negocio: trae un código y datos extra que quedan en el cuerpo', async () => {
      const existente = { documentoId: 4, version: 1, titulo: 'Acta', expediente: 'E-1', serieCodigo: '100-01' };
      simularFetch(
        json({ statusCode: 409, error: 'Conflict', message: 'Ya existe un archivo idéntico', codigo: 'duplicado_exacto', existente }, 409),
      );
      const error = await fallo(pedir('/documentos', { metodo: 'POST' }));
      expect(error.estado).toBe(409);
      expect(error.codigo).toBe('duplicado_exacto');
      expect(error.cuerpo).toMatchObject({ existente });
    });

    it('de validación: sin statusCode pero con la lista de problemas', async () => {
      simularFetch(
        json({ message: 'Parámetros inválidos: tamano: tamano no puede pasar de 50', problemas: ['tamano: tamano no puede pasar de 50'] }, 400),
      );
      const error = await fallo(pedir('/documentos'));
      expect(error.estado).toBe(400);
      expect(error.message).toMatch(/Parámetros inválidos/);
      expect(error.problemas).toEqual(['tamano: tamano no puede pasar de 50']);
    });

    it('con message como lista, la une', async () => {
      simularFetch(json({ message: ['uno', 'dos'] }, 400));
      expect((await fallo(pedir('/x'))).message).toBe('uno; dos');
    });

    it('sin JSON (la página de error de un proxy): mensaje propio según el estado', async () => {
      simularFetch(responder('<html>Bad Gateway</html>', 502));
      const error = await fallo(pedir('/documentos'));
      expect(error.estado).toBe(502);
      expect(error.message).toMatch(/servidor tuvo un problema/);
      expect(error.cuerpo).toBe('<html>Bad Gateway</html>');
    });

    it('cuerpo vacío: mensaje propio según el estado', async () => {
      simularFetch(responder(null, 403));
      expect((await fallo(pedir('/usuarios'))).message).toBe('No tienes permiso para esta acción.');
    });

    it('un cuerpo JSON que no es un objeto no rompe la lectura', async () => {
      simularFetch(json(['x'], 500));
      expect((await fallo(pedir('/x'))).estado).toBe(500);
    });

    it('una guarda de origen: 403 con su código', async () => {
      simularFetch(
        json({ statusCode: 403, error: 'Forbidden', codigo: 'origen_no_permitido', message: 'La petición viene de un origen no permitido' }, 403),
      );
      const error = await fallo(pedir('/auth/login', { metodo: 'POST' }));
      expect(error.estado).toBe(403);
      expect(error.codigo).toBe('origen_no_permitido');
    });
  });

  describe('429 y Retry-After', () => {
    it('lee los segundos de espera', async () => {
      simularFetch(
        json({ statusCode: 429, error: 'Too Many Requests', codigo: 'demasiados_intentos', message: 'Demasiados intentos de ingreso. Intenta de nuevo en 10 minutos.' }, 429, { 'Retry-After': '600' }),
      );
      const error = await fallo(pedir('/auth/login', { metodo: 'POST' }));
      expect(error.estado).toBe(429);
      expect(error.codigo).toBe('demasiados_intentos');
      expect(error.esperaSeg).toBe(600);
    });

    it('sin cabecera, esperaSeg queda indefinido', async () => {
      simularFetch(json({ message: 'x' }, 429));
      expect((await fallo(pedir('/x'))).esperaSeg).toBeUndefined();
    });
  });

  describe('fallos de red', () => {
    it('sin respuesta: ErrorApi con estado 0', async () => {
      simularFetch(new TypeError('Failed to fetch'));
      const error = await fallo(pedir('/series'));
      expect(error.estado).toBe(0);
      expect(error.message).toMatch(/No se pudo conectar/);
    });

    it('una petición cancelada a propósito propaga el AbortError y no es un ErrorApi', async () => {
      simularFetch(new DOMException('cancelada', 'AbortError'));
      await expect(pedir('/series')).rejects.toMatchObject({ name: 'AbortError' });
      await expect(pedir('/series')).rejects.not.toBeInstanceOf(ErrorApi);
    });
  });

  describe('sesión vencida (401)', () => {
    afterEach(() => {
      // Cada prueba registra y quita su manejador; esto es por si una falla a mitad.
      alExpirarLaSesion(() => undefined)();
    });

    it('un 401 avisa al manejador registrado y lanza el error', async () => {
      const manejador = vi.fn();
      alExpirarLaSesion(manejador);
      simularFetch(json({ statusCode: 401, message: 'Se requiere iniciar sesión' }, 401));
      const error = await fallo(pedir('/documentos'));
      expect(error.estado).toBe(401);
      expect(manejador).toHaveBeenCalledTimes(1);
    });

    it('con ignorar401 (el ingreso, quién soy) no avisa: ahí un 401 es esperado', async () => {
      const manejador = vi.fn();
      alExpirarLaSesion(manejador);
      simularFetch(json({ message: 'Usuario o clave incorrectos' }, 401));
      const error = await fallo(pedir('/auth/login', { metodo: 'POST', ignorar401: true }));
      expect(error.estado).toBe(401);
      expect(manejador).not.toHaveBeenCalled();
    });

    it('otros errores (403, 404, 500) no cierran la sesión', async () => {
      const manejador = vi.fn();
      alExpirarLaSesion(manejador);
      for (const estado of [403, 404, 500]) {
        simularFetch(json({ message: 'x' }, estado));
        await fallo(pedir('/documentos'));
      }
      expect(manejador).not.toHaveBeenCalled();
    });

    it('quitar el manejador (lo que hace el desmontaje) evita nuevos avisos', async () => {
      const manejador = vi.fn();
      const quitar = alExpirarLaSesion(manejador);
      quitar();
      simularFetch(json({ message: 'x' }, 401));
      await fallo(pedir('/documentos'));
      expect(manejador).not.toHaveBeenCalled();
    });

    it('un manejador viejo no quita al nuevo', async () => {
      const viejo = vi.fn();
      const nuevo = vi.fn();
      const quitarViejo = alExpirarLaSesion(viejo);
      alExpirarLaSesion(nuevo);
      quitarViejo();
      simularFetch(json({ message: 'x' }, 401));
      await fallo(pedir('/documentos'));
      expect(nuevo).toHaveBeenCalledTimes(1);
    });
  });
});

describe('leerEspera', () => {
  it('segundos enteros', () => {
    expect(leerEspera('90')).toBe(90);
    expect(leerEspera(' 5 ')).toBe(5);
  });

  it('fecha HTTP: los segundos que faltan, redondeando hacia arriba y sin bajar de cero', () => {
    const ahora = Date.parse('2026-11-22T10:00:00Z');
    expect(leerEspera('Sun, 22 Nov 2026 10:00:30 GMT', ahora)).toBe(30);
    expect(leerEspera('Sun, 22 Nov 2026 09:00:00 GMT', ahora)).toBe(0);
  });

  it('ausente o ilegible: indefinido', () => {
    expect(leerEspera(null)).toBeUndefined();
    expect(leerEspera('')).toBeUndefined();
    expect(leerEspera('pronto')).toBeUndefined();
  });
});
