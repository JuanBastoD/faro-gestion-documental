/** Lo que importa de una petición para decidir si viene de un origen aceptable (ADR-009). */
export interface DatosDeOrigen {
  metodo: string;
  /** Encabezado `Origin`, tal como llegó. */
  origin: string | undefined;
  /** Encabezado `Host`, tal como llegó. */
  host: string | undefined;
  /** Encabezado `Sec-Fetch-Site`, que los navegadores modernos envían siempre. */
  secFetchSite: string | undefined;
}

const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Defensa contra CSRF por verificación de origen (OWASP, «Verifying Origin With Standard Headers»), que se suma
 * a la cookie `SameSite=Lax`. Solo mira las peticiones que modifican datos:
 *
 * 1. Con `Origin`: debe ser el propio sitio (mismo `Host`) o uno de la lista de permitidos. `Origin: null`
 *    (iframes con sandbox, algunas redirecciones) no es un origen y se rechaza.
 * 2. Sin `Origin` pero con `Sec-Fetch-Site`: solo `same-origin` (o `none`, una acción directa del usuario).
 * 3. Sin ninguno de los dos: no es un navegador (curl, otro servidor, pruebas) y se deja pasar. Un navegador
 *    siempre manda `Origin` en un POST entre sitios, así que esta rama no abre un camino para un ataque CSRF.
 *    [POR VERIFICAR] con navegadores reales cuando exista la interfaz (V2-M4): hasta hoy solo se probó con peticiones
 *    construidas a mano.
 */
export function origenPermitido(datos: DatosDeOrigen, permitidos: readonly string[]): boolean {
  if (METODOS_SEGUROS.has(datos.metodo.toUpperCase())) return true;

  if (datos.origin !== undefined) {
    if (permitidos.includes(datos.origin)) return true;
    if (!URL.canParse(datos.origin)) return false;
    const origen = new URL(datos.origin);
    if (origen.protocol !== 'http:' && origen.protocol !== 'https:') return false;
    return datos.host !== undefined && origen.host === datos.host.toLowerCase();
  }

  if (datos.secFetchSite !== undefined) {
    return datos.secFetchSite === 'same-origin' || datos.secFetchSite === 'none';
  }

  return true;
}
