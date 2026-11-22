import argon2 from 'argon2';

/** argon2id con los parámetros por defecto de la librería (64 MiB, 3 pasadas). */
export function hashear(clave: string): Promise<string> {
  return argon2.hash(clave, { type: argon2.argon2id });
}

/** Devuelve false ante una clave incorrecta o un hash ilegible; nunca lanza por eso. */
export async function verificar(hash: string, clave: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, clave);
  } catch {
    return false;
  }
}

let hashFalso: Promise<string> | undefined;

/**
 * Hash de una clave que nadie conoce. Cuando el usuario no existe se verifica
 * contra este, para que responder tarde lo mismo y el tiempo no revele qué
 * usuarios existen.
 */
export function hashDeRelleno(): Promise<string> {
  hashFalso ??= hashear('relleno-que-no-corresponde-a-ningun-usuario');
  return hashFalso;
}
