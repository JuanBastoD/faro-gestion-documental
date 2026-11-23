import { describe, expect, it } from 'vitest';
import { ErrorApi } from '../api/cliente';
import { formatearEspera, formatearFecha, formatearFechaHora, formatearTamano } from './formato';
import { mensajeDeError } from './mensajes';

describe('formatearTamano', () => {
  it.each([
    [0, '0 B'],
    [850, '850 B'],
    [1024, '1,0 KB'],
    [12595, '12,3 KB'],
    [5 * 1024 * 1024, '5,0 MB'],
  ])('%i bytes se lee %s', (bytes, texto) => {
    expect(formatearTamano(bytes)).toBe(texto);
  });
});

describe('formatearEspera', () => {
  it.each([
    [1, '1 segundo'],
    [30, '30 segundos'],
    [59.2, '60 segundos'],
    [60, '1 minuto'],
    [61, '2 minutos'],
    [600, '10 minutos'],
    [900, '15 minutos'],
  ])('%s s se dice «%s»', (segundos, texto) => {
    expect(formatearEspera(segundos)).toBe(texto);
  });

  it('nunca dice cero segundos', () => {
    expect(formatearEspera(0)).toBe('1 segundo');
  });
});

describe('fechas', () => {
  it('una fecha de calendario no se corre un día por la zona horaria', () => {
    expect(formatearFecha('2026-03-01')).toMatch(/1 de marzo de 2026/);
    expect(formatearFecha('2026-12-31')).toMatch(/31 de diciembre de 2026/);
  });

  it('un instante se muestra en la hora de Colombia (UTC-5)', () => {
    // 15:30 UTC son las 10:30 en Bogotá.
    expect(formatearFechaHora('2026-11-20T15:30:00.000Z')).toMatch(/10:30/);
  });

  it('lo que no es una fecha se devuelve tal cual, sin romper', () => {
    expect(formatearFecha('ayer')).toBe('ayer');
    expect(formatearFecha('2026-02-31')).toBe('2026-02-31');
    expect(formatearFechaHora('no es fecha')).toBe('no es fecha');
  });
});

describe('mensajeDeError', () => {
  const error = (estado: number, mensaje: string, esperaSeg?: number) => new ErrorApi({ estado, mensaje, esperaSeg });

  it('4xx de negocio: el mensaje de la API', () => {
    expect(mensajeDeError(error(401, 'Usuario o clave incorrectos'))).toBe('Usuario o clave incorrectos');
    expect(mensajeDeError(error(404, 'No existe el documento 9'))).toBe('No existe el documento 9');
  });

  it('429: arma el tiempo con Retry-After, no con el mensaje del servidor', () => {
    expect(mensajeDeError(error(429, 'texto del servidor', 600))).toBe('Demasiados intentos de ingreso. Intenta de nuevo en 10 minutos.');
    expect(mensajeDeError(error(429, 'texto del servidor', 45))).toBe('Demasiados intentos de ingreso. Intenta de nuevo en 45 segundos.');
    expect(mensajeDeError(error(429, 'texto del servidor'))).toMatch(/Demasiados intentos/);
  });

  it('sin red y 5xx: texto propio, nunca el técnico del servidor', () => {
    expect(mensajeDeError(error(0, 'x'))).toMatch(/No se pudo conectar/);
    expect(mensajeDeError(error(500, 'stack trace interno'))).toMatch(/servidor tuvo un problema/);
    expect(mensajeDeError(error(500, 'stack trace interno'))).not.toMatch(/stack/);
  });

  it('algo que no es un ErrorApi', () => {
    expect(mensajeDeError(new Error('x'))).toMatch(/error inesperado/);
    expect(mensajeDeError(undefined)).toMatch(/error inesperado/);
  });
});
