/**
 * Catálogo de acciones auditadas. Cada función nueva agrega las suyas aquí
 * (docs/PLAN_EJECUCION.md, #14): carga, versión, restauración, descarga,
 * decisión ante un duplicado y administración de usuarios.
 */
export const ACCION = {
  INGRESO: 'ingreso',
  INGRESO_FALLIDO: 'ingreso_fallido',
  CIERRE_SESION: 'cierre_sesion',
  ACCESO_DENEGADO: 'acceso_denegado',
  CARGA: 'carga',
  DESCARGA: 'descarga',
  VERSION: 'version',
  RESTAURACION: 'restauracion',
  DECISION_DUPLICADO: 'decision_duplicado',
} as const;

export type Accion = (typeof ACCION)[keyof typeof ACCION];
