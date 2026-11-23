export const ROLES = ['administrador', 'editor', 'consulta'] as const;
export type Rol = (typeof ROLES)[number];

/** Lo que las guardas y los controladores saben de quien hace la petición. */
export interface UsuarioSesion {
  id: number;
  usuario: string;
  nombre: string;
  rol: Rol;
  /**
   * La clave actual es una temporal que fijó un administrador (ADR-011). Se lee de la base en cada petición,
   * igual que el rol: mientras sea true, la guarda de autenticación solo deja pasar lo marcado con
   * `@PermitidoConClaveTemporal()`.
   */
  debeCambiarClave: boolean;
}
