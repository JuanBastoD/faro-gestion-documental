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

/** `POST /usuarios` (administrador). 409 si el nombre ya existe. */
export function crearUsuario(datos: NuevoUsuario): Promise<UsuarioAdministrado> {
  return pedir<UsuarioAdministrado>('/usuarios', { metodo: 'POST', cuerpo: datos });
}

/** `PATCH /usuarios/:id` (administrador). 409 `ultimo_administrador` si dejaría al sistema sin administradores. */
export function cambiarUsuario(id: number, cambio: CambioDeUsuario): Promise<UsuarioAdministrado> {
  return pedir<UsuarioAdministrado>(`/usuarios/${id}`, { metodo: 'PATCH', cuerpo: cambio });
}
