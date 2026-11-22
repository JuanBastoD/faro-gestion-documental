import { COOKIE_SESION, leerCookie, opcionesCookie } from './cookie-sesion.js';
import { hashDeRelleno, hashear, verificar } from './hash-clave.js';

describe('hash de claves (argon2id)', () => {
  it('verifica la clave correcta y rechaza la incorrecta', async () => {
    const hash = await hashear('clave-uno-2026');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verificar(hash, 'clave-uno-2026')).toBe(true);
    expect(await verificar(hash, 'clave-dos-2026')).toBe(false);
  });

  it('la misma clave produce hashes distintos (sal aleatoria)', async () => {
    const [a, b] = await Promise.all([hashear('misma'), hashear('misma')]);
    expect(a).not.toBe(b);
  });

  it('un hash ilegible no lanza: simplemente no verifica', async () => {
    expect(await verificar('esto-no-es-un-hash', 'x')).toBe(false);
    expect(await verificar('', 'x')).toBe(false);
  });

  it('el hash de relleno es un argon2id válido y siempre el mismo', async () => {
    const [a, b] = await Promise.all([hashDeRelleno(), hashDeRelleno()]);
    expect(a).toBe(b);
    expect(a).toMatch(/^\$argon2id\$/);
    expect(await verificar(a, 'cualquier-cosa')).toBe(false);
  });
});

describe('cookie de sesión', () => {
  it('lee la cookie entre otras', () => {
    expect(leerCookie('a=1; faro_sesion=abc123; b=2', COOKIE_SESION)).toBe('abc123');
    expect(leerCookie('faro_sesion=solo', COOKIE_SESION)).toBe('solo');
  });

  it('devuelve undefined si falta, está vacía o no hay cabecera', () => {
    expect(leerCookie(undefined, COOKIE_SESION)).toBeUndefined();
    expect(leerCookie('', COOKIE_SESION)).toBeUndefined();
    expect(leerCookie('otra=1', COOKIE_SESION)).toBeUndefined();
    expect(leerCookie('faro_sesion=', COOKIE_SESION)).toBeUndefined();
  });

  it('no confunde un nombre que solo termina igual', () => {
    expect(leerCookie('x_faro_sesion=malo', COOKIE_SESION)).toBeUndefined();
  });

  it('las opciones son httpOnly y SameSite=Lax; Secure solo en producción', () => {
    expect(opcionesCookie(false)).toMatchObject({ httpOnly: true, sameSite: 'lax', secure: false });
    expect(opcionesCookie(true)).toMatchObject({ httpOnly: true, sameSite: 'lax', secure: true });
  });
});
