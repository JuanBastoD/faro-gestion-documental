export const ROLES = ['administrador', 'editor', 'consulta'] as const;
export type Rol = (typeof ROLES)[number];

/** Lo que las guardas y los controladores saben de quien hace la petición. */
export interface UsuarioSesion {
  id: number;
  usuario: string;
  nombre: string;
  rol: Rol;
}
