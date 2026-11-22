/**
 * Dirección de la base de datos de las pruebas de integración.
 * Las pruebas vacían tablas, así que nunca deben tocar la base de desarrollo:
 *  - si existe DATABASE_URL_TEST se usa esa;
 *  - si no, la de DATABASE_URL con "_test" añadido al nombre (faro → faro_test).
 * En cualquier caso el nombre de la base debe terminar en "_test".
 */
export function urlDePruebas(env: Record<string, string | undefined> = process.env): string {
  const explicita = env.DATABASE_URL_TEST;
  let url: URL;
  if (explicita) {
    url = new URL(explicita);
  } else {
    if (!env.DATABASE_URL) {
      throw new Error('Falta DATABASE_URL (o DATABASE_URL_TEST). Copia .env.example a .env.');
    }
    url = new URL(env.DATABASE_URL);
    url.pathname = `${url.pathname}_test`;
  }
  if (!/^\/[a-z0-9_]+_test$/.test(url.pathname)) {
    throw new Error(
      'La base de las pruebas debe llamarse como [a-z0-9_]+_test: las pruebas vacían sus tablas.',
    );
  }
  return url.toString();
}

/** Nombre de la base (sin la barra inicial). */
export function nombreDeBase(url: string): string {
  return new URL(url).pathname.slice(1);
}
