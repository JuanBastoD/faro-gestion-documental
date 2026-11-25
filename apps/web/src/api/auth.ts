import { ErrorApi, pedir } from './cliente';

/** Los tres roles de la API (`apps/api/src/auth/roles.ts`). */
export type Rol = 'administrador' | 'editor' | 'consulta';

/** Quién tiene la sesión (`UsuarioSesion` de la API). */
export interface UsuarioSesion {
  id: number;
  usuario: string;
  nombre: string;
  rol: Rol;
  /**
   * `true` mientras la clave sea temporal (la restableció un administrador, #57): la API no deja hacer nada más que cambiarla.
   * Es opcional a propósito: una API anterior a #57 no manda el campo y eso equivale a «no».
   */
  debeCambiarClave?: boolean;
}

/**
 * `POST /auth/login`. Responde 200 con el usuario y pone la cookie `faro_sesion`. 401 si las credenciales son
 * incorrectas (el mismo mensaje para usuario inexistente, inactivo o clave errónea); 429 con `Retry-After` tras
 * demasiados intentos (ADR-009). Un 401 aquí es una respuesta esperada, no una sesión vencida.
 */
export async function ingresar(usuario: string, clave: string): Promise<UsuarioSesion> {
  const { usuario: datos } = await pedir<{ usuario: UsuarioSesion }>('/auth/login', {
    metodo: 'POST',
    cuerpo: { usuario, clave },
    ignorar401: true,
  });
  return datos;
}

/**
 * `GET /auth/yo`. La API exige sesión también aquí: sin sesión responde 401 (no `{ usuario: null }`), así que un
 * 401 se traduce a `null`. Cualquier otro error se propaga.
 */
export async function quienSoy(senal?: AbortSignal): Promise<UsuarioSesion | null> {
  try {
    const { usuario } = await pedir<{ usuario: UsuarioSesion | null }>('/auth/yo', { senal, ignorar401: true });
    return usuario;
  } catch (error) {
    if (error instanceof ErrorApi && error.estado === 401) return null;
    throw error;
  }
}

/** Cuerpo de `POST /auth/clave`. */
export interface CambioDeClave {
  claveActual: string;
  claveNueva: string;
}

/**
 * `POST /auth/clave` (con sesión, cualquier rol; también con clave temporal). 204 sin cuerpo: la sesión de esta pestaña sigue
 * válida y las demás sesiones de la persona se cierran. 400 `clave_actual_incorrecta` NUNCA es 401: es un error del campo, no una
 * sesión vencida. 429 con `Retry-After` (los fallos de la clave actual cuentan para el mismo límite que el ingreso) y 409
 * `conflicto_de_clave` si otra petición cambió la clave a la vez. Contrato en `docs/adr/0011` (PR #57).
 */
export async function cambiarClave(datos: CambioDeClave, senal?: AbortSignal): Promise<void> {
  await pedir<void>('/auth/clave', { metodo: 'POST', cuerpo: datos, senal });
}

/** `POST /auth/logout`: 204 sin cuerpo; borra la sesión del servidor y la cookie. */
export async function salir(): Promise<void> {
  await pedir<void>('/auth/logout', { metodo: 'POST', ignorar401: true });
}
