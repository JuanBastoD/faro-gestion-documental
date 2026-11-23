import { ErrorApi, pedir } from './cliente';

/** Los tres roles de la API (`apps/api/src/auth/roles.ts`). */
export type Rol = 'administrador' | 'editor' | 'consulta';

/** Quién tiene la sesión (`UsuarioSesion` de la API). */
export interface UsuarioSesion {
  id: number;
  usuario: string;
  nombre: string;
  rol: Rol;
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

/** `POST /auth/logout`: 204 sin cuerpo; borra la sesión del servidor y la cookie. */
export async function salir(): Promise<void> {
  await pedir<void>('/auth/logout', { metodo: 'POST', ignorar401: true });
}
