import type { Rol } from './auth';
import { pedir } from './cliente';

/** Lo que la administración ve de un usuario. Nunca incluye la clave. */
export interface UsuarioAdministrado {
  id: number;
  usuario: string;
  nombre: string;
  rol: Rol;
  activo: boolean;
  creadoEn: string;
}

/** Cuerpo de `POST /usuarios`. `usuario`: minúsculas (3 a 64: letras, números, `.`, `-`, `_`); `clave`: 12 a 256. */
export interface NuevoUsuario {
  usuario: string;
  nombre: string;
  rol: Rol;
  clave: string;
}

/** Cuerpo de `PATCH /usuarios/:id`: al menos uno de los dos. */
export interface CambioDeUsuario {
  rol?: Rol;
  activo?: boolean;
}

/** `GET /usuarios` (administrador): todos, activos e inactivos, por orden de creación. No se pagina. */
export function listarUsuarios(senal?: AbortSignal): Promise<UsuarioAdministrado[]> {
  return pedir<UsuarioAdministrado[]>('/usuarios', { senal });
}

/**
 * Los límites de `apps/api/src/usuarios/datos-usuario.ts`. El navegador los repite para avisar antes de enviar; la API
 * vuelve a validar y es la que decide. El nombre de usuario se mide ya sin espacios en los extremos (la API los quita).
 */
export const LIMITES_DE_USUARIO = {
  usuarioMinimo: 3,
  usuarioMaximo: 64,
  nombre: 120,
  claveMinima: 12,
  claveMaxima: 256,
} as const;

/** `POST /usuarios` (administrador). 201 con el usuario creado (sin la clave). 409 `usuario_existente` si el nombre ya existe. */
export function crearUsuario(datos: NuevoUsuario, senal?: AbortSignal): Promise<UsuarioAdministrado> {
  return pedir<UsuarioAdministrado>('/usuarios', { metodo: 'POST', cuerpo: datos, senal });
}

/**
 * `PATCH /usuarios/:id` (administrador). Responde 200 con el usuario ya cambiado; si no cambia nada, 200 igual y sin evento en
 * la auditoría. 409 `ultimo_administrador` si dejaría al sistema sin administradores. Desactivar cierra las sesiones de
 * esa persona al instante (ADR-008).
 */
export function cambiarUsuario(id: number, cambio: CambioDeUsuario, senal?: AbortSignal): Promise<UsuarioAdministrado> {
  return pedir<UsuarioAdministrado>(`/usuarios/${id}`, { metodo: 'PATCH', cuerpo: cambio, senal });
}
