/**
 * Generador de claves temporales para «Restablecer clave» (#51). Se genera en el navegador con `crypto.getRandomValues` (no con
 * `Math.random`, que no es apto para claves) y no se envía a ningún lado hasta que el administrador confirma.
 */

/**
 * Letras y números sin los que se confunden al leerlos o dictarlos por teléfono: sin 0 y O, 1, l e I. Son 57 símbolos (62 menos
 * esos 5); una clave de 16 trae unos 93 bits de azar (16 x log2(57)).
 */
export const ALFABETO_DE_CLAVE = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/** Cuántos símbolos lleva una clave generada (sin contar los guiones que separan los grupos). */
export const LONGITUD_DE_CLAVE_GENERADA = 16;

/** Tamaño de cada grupo separado por guion: `Xk3P-9mTq-Wc7R-vD2e` se lee y se dicta mejor que una cadena de 16. */
export const TAMANO_DE_GRUPO = 4;

/** Una fuente de bytes aleatorios; en el navegador es `crypto.getRandomValues`. Se puede cambiar en las pruebas. */
export type FuenteDeBytes = (cantidad: number) => Uint8Array;

export const bytesDelNavegador: FuenteDeBytes = (cantidad) => crypto.getRandomValues(new Uint8Array(cantidad));

/**
 * Una clave temporal nueva. Para que cada símbolo sea igual de probable se descartan los bytes que no caben en un múltiplo exacto
 * del alfabeto (con 57 símbolos, los de 228 a 255): usar el resto de la división sin descartar favorecería a los primeros símbolos.
 */
export function generarClaveTemporal(fuente: FuenteDeBytes = bytesDelNavegador): string {
  const limite = 256 - (256 % ALFABETO_DE_CLAVE.length);
  let simbolos = '';
  while (simbolos.length < LONGITUD_DE_CLAVE_GENERADA) {
    for (const byte of fuente(LONGITUD_DE_CLAVE_GENERADA * 2)) {
      if (byte >= limite) continue;
      simbolos += ALFABETO_DE_CLAVE[byte % ALFABETO_DE_CLAVE.length];
      if (simbolos.length === LONGITUD_DE_CLAVE_GENERADA) break;
    }
  }
  const grupos: string[] = [];
  for (let i = 0; i < simbolos.length; i += TAMANO_DE_GRUPO) grupos.push(simbolos.slice(i, i + TAMANO_DE_GRUPO));
  return grupos.join('-');
}
