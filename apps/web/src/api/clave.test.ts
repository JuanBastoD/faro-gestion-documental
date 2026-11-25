import { afterEach, describe, expect, it, vi } from 'vitest';
import { cambiarClave, quienSoy } from './auth';
import { alExpirarLaSesion, alRequerirCambioDeClave, ErrorApi, pedir } from './cliente';
import { restablecerClave } from './usuarios';
import { respuestaJson, simularApi } from '../pruebas/ayudas';

afterEach(() => vi.unstubAllGlobals());

describe('cambiarClave y restablecerClave: lo que se manda a la API', () => {
  it('cambiarClave hace POST /auth/clave con claveActual y claveNueva, y espera 204', async () => {
    const api = simularApi({ 'POST /auth/clave': () => new Response(null, { status: 204 }) });
    await expect(cambiarClave({ claveActual: 'a'.repeat(14), claveNueva: 'b'.repeat(14) })).resolves.toBeUndefined();
    expect(api.a('POST', '/auth/clave')).toHaveLength(1);
    expect(api.a('POST', '/auth/clave')[0].cuerpo).toEqual({ claveActual: 'a'.repeat(14), claveNueva: 'b'.repeat(14) });
  });

  it('restablecerClave hace POST /usuarios/:id/clave con solo la clave', async () => {
    const api = simularApi({ 'POST /usuarios/7/clave': () => new Response(null, { status: 204 }) });
    await restablecerClave(7, 'c'.repeat(14));
    expect(api.a('POST', '/usuarios/7/clave')[0].cuerpo).toEqual({ clave: 'c'.repeat(14) });
  });

  it('el 400 clave_actual_incorrecta llega como error 400 con su código y NO avisa que la sesión terminó', async () => {
    simularApi({
      'POST /auth/clave': () =>
        respuestaJson({ statusCode: 400, error: 'Bad Request', codigo: 'clave_actual_incorrecta', message: 'La clave actual no es correcta' }, 400),
    });
    const sesionTerminada = vi.fn();
    const quitar = alExpirarLaSesion(sesionTerminada);
    const fallo = await cambiarClave({ claveActual: 'x', claveNueva: 'y'.repeat(14) }).catch((e: unknown) => e);
    quitar();
    expect(fallo).toBeInstanceOf(ErrorApi);
    expect((fallo as ErrorApi).estado).toBe(400);
    expect((fallo as ErrorApi).codigo).toBe('clave_actual_incorrecta');
    expect(sesionTerminada).not.toHaveBeenCalled();
  });

  it('el 429 trae Retry-After en segundos', async () => {
    simularApi({ 'POST /auth/clave': () => respuestaJson({ codigo: 'demasiados_intentos', message: 'x' }, 429, { 'Retry-After': '900' }) });
    const fallo = await cambiarClave({ claveActual: 'x', claveNueva: 'y'.repeat(14) }).catch((e: unknown) => e);
    expect((fallo as ErrorApi).estado).toBe(429);
    expect((fallo as ErrorApi).esperaSeg).toBe(900);
  });

  it('un 401 al cambiar la clave sí avisa que la sesión terminó (no hay sesión)', async () => {
    simularApi({ 'POST /auth/clave': () => respuestaJson({ message: 'Se requiere iniciar sesión' }, 401) });
    const sesionTerminada = vi.fn();
    const quitar = alExpirarLaSesion(sesionTerminada);
    await cambiarClave({ claveActual: 'x', claveNueva: 'y'.repeat(14) }).catch(() => undefined);
    quitar();
    expect(sesionTerminada).toHaveBeenCalledTimes(1);
  });

  it('quienSoy conserva debeCambiarClave tal como lo manda la API, y tolera que falte', async () => {
    simularApi({
      'GET /auth/yo': () => respuestaJson({ usuario: { id: 1, usuario: 'ana.demo', nombre: 'Ana Demo', rol: 'editor', debeCambiarClave: true } }),
    });
    expect((await quienSoy())?.debeCambiarClave).toBe(true);
    simularApi({ 'GET /auth/yo': () => respuestaJson({ usuario: { id: 1, usuario: 'ana.demo', nombre: 'Ana Demo', rol: 'editor' } }) });
    expect((await quienSoy())?.debeCambiarClave).toBeUndefined();
  });
});

describe('403 cambio_de_clave_requerido', () => {
  const requerido = () => respuestaJson({ statusCode: 403, error: 'Forbidden', codigo: 'cambio_de_clave_requerido', message: 'Debes cambiar la clave temporal antes de continuar' }, 403);

  it('avisa al manejador registrado, venga de la ruta que venga', async () => {
    simularApi({ 'GET /series': requerido, 'GET /documentos': requerido });
    const manejador = vi.fn();
    const quitar = alRequerirCambioDeClave(manejador);
    await pedir('/series').catch(() => undefined);
    await pedir('/documentos').catch(() => undefined);
    quitar();
    expect(manejador).toHaveBeenCalledTimes(2);
  });

  it('un 403 de rol (sin código) o de origen no lo dispara', async () => {
    simularApi({
      'GET /usuarios': () => respuestaJson({ statusCode: 403, message: 'No tienes permiso' }, 403),
      'POST /usuarios': () => respuestaJson({ codigo: 'origen_no_permitido', message: 'x' }, 403),
    });
    const manejador = vi.fn();
    const quitar = alRequerirCambioDeClave(manejador);
    await pedir('/usuarios').catch(() => undefined);
    await pedir('/usuarios', { metodo: 'POST', cuerpo: {} }).catch(() => undefined);
    quitar();
    expect(manejador).not.toHaveBeenCalled();
  });

  it('el mismo código con otro estado no lo dispara', async () => {
    simularApi({ 'GET /series': () => respuestaJson({ codigo: 'cambio_de_clave_requerido', message: 'x' }, 409) });
    const manejador = vi.fn();
    const quitar = alRequerirCambioDeClave(manejador);
    await pedir('/series').catch(() => undefined);
    quitar();
    expect(manejador).not.toHaveBeenCalled();
  });

  it('el 403 sigue llegando a quien llamó como ErrorApi con su código', async () => {
    simularApi({ 'GET /series': requerido });
    const fallo = await pedir('/series').catch((e: unknown) => e);
    expect(fallo).toBeInstanceOf(ErrorApi);
    expect((fallo as ErrorApi).codigo).toBe('cambio_de_clave_requerido');
  });

  it('quitar el manejador deja de avisarle', async () => {
    simularApi({ 'GET /series': requerido });
    const manejador = vi.fn();
    alRequerirCambioDeClave(manejador)();
    await pedir('/series').catch(() => undefined);
    expect(manejador).not.toHaveBeenCalled();
  });
});
