import { createContext, useContext } from 'react';
import type { UsuarioSesion } from '../api/auth';

/**
 * Qué se sabe de la sesión. `cargando` dura lo que tarda `GET /auth/yo` al abrir la interfaz; mientras tanto no se
 * decide nada (ni se muestra el ingreso ni se deja pasar), para no parpadear ni expulsar a quien sí tiene sesión.
 */
export type EstadoDeSesion =
  | { tipo: 'cargando' }
  /** `expirada`: tenía sesión y la API respondió 401 (venció o la cerraron). Se avisa en el ingreso. */
  | { tipo: 'anonimo'; expirada: boolean }
  | { tipo: 'autenticado'; usuario: UsuarioSesion };

export interface ValorDeSesion {
  estado: EstadoDeSesion;
  /** Abre la sesión. Si la API la rechaza (401, 429...) lanza `ErrorApi` para que el formulario lo muestre. */
  ingresar: (usuario: string, clave: string) => Promise<void>;
  /** Cierra la sesión en el servidor y en la interfaz. Aunque el servidor falle, la interfaz queda sin sesión. */
  salir: () => Promise<void>;
  /**
   * Vuelve a preguntar a la API quién tiene la sesión y actualiza el estado. Sirve cuando algo pudo cambiar el rol de la
   * persona sin que la interfaz se enterara (se lo cambió ella misma, o otro administrador: la API lo aplica al instante). Si
   * ya no hay sesión, pasa al ingreso con el aviso. Sin red conserva lo que había.
   */
  refrescar: () => Promise<void>;
}

export const ContextoSesion = createContext<ValorDeSesion | null>(null);

export function useSesion(): ValorDeSesion {
  const valor = useContext(ContextoSesion);
  if (!valor) throw new Error('useSesion se usa dentro de <ProveedorSesion>');
  return valor;
}
