import { EntornoInvalidoError, validarEntorno } from './entorno.js';

const URL_VALIDA = 'postgresql://faro:clave-secreta-123@localhost:5433/faro';

describe('validarEntorno', () => {
  it('acepta un entorno mínimo y aplica los valores por defecto', () => {
    const entorno = validarEntorno({ DATABASE_URL: URL_VALIDA });
    expect(entorno).toEqual({
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: 3000,
      DATABASE_URL: URL_VALIDA,
    });
  });

  it('convierte PORT de texto a número (Cloud Run lo entrega como texto)', () => {
    const entorno = validarEntorno({ DATABASE_URL: URL_VALIDA, PORT: '8080', HOST: '0.0.0.0' });
    expect(entorno.PORT).toBe(8080);
    expect(entorno.HOST).toBe('0.0.0.0');
  });

  it('acepta postgres:// además de postgresql://', () => {
    expect(() => validarEntorno({ DATABASE_URL: 'postgres://u:p@host/db' })).not.toThrow();
  });

  it('falla y nombra DATABASE_URL cuando falta', () => {
    expect(() => validarEntorno({})).toThrow(EntornoInvalidoError);
    expect(() => validarEntorno({})).toThrow(/DATABASE_URL: es obligatoria/);
  });

  it('falla si DATABASE_URL no es de PostgreSQL', () => {
    expect(() => validarEntorno({ DATABASE_URL: 'mysql://u:p@host/db' })).toThrow(
      /DATABASE_URL: debe empezar por postgresql:\/\/ o postgres:\/\//,
    );
  });

  it.each(['abc', '0', '70000', '30.5', ''])('rechaza PORT inválido (%j)', (puerto) => {
    expect(() => validarEntorno({ DATABASE_URL: URL_VALIDA, PORT: puerto })).toThrow(/PORT:/);
  });

  it('rechaza NODE_ENV desconocido', () => {
    expect(() => validarEntorno({ DATABASE_URL: URL_VALIDA, NODE_ENV: 'staging' })).toThrow(
      /NODE_ENV: debe ser development, test o production/,
    );
  });

  it('informa todos los problemas a la vez, no solo el primero', () => {
    let mensaje = '';
    try {
      validarEntorno({ PORT: 'x' });
    } catch (error) {
      mensaje = (error as Error).message;
    }
    expect(mensaje).toMatch(/PORT:/);
    expect(mensaje).toMatch(/DATABASE_URL:/);
  });

  it('nunca incluye el valor de DATABASE_URL (lleva la clave) en el mensaje de error', () => {
    let mensaje = '';
    try {
      validarEntorno({ DATABASE_URL: 'mysql://faro:clave-secreta-123@host/db' });
    } catch (error) {
      mensaje = (error as Error).message;
    }
    expect(mensaje).not.toContain('clave-secreta-123');
    expect(mensaje).not.toContain('mysql://');
  });
});
