/**
 * Lo que la pantalla de auditoría sabe del catálogo de acciones (`apps/api/src/auditoria/acciones.ts`). La API devuelve el
 * código en texto (`usuario_rol_cambiado`) y solo acepta como filtro un código de su catálogo: aquí está el texto que ve la
 * persona y la lista que se ofrece para filtrar.
 */

/**
 * Cómo se muestra cada acción. Una acción que no esté aquí (la API agregó una nueva) se muestra con su código, tal cual: nunca
 * se oculta un evento. Las tres últimas todavía no están en el catálogo de esta rama (llegan con #19 y #51); tener su texto
 * no cuesta nada y evita mostrar el código crudo cuando se fusionen.
 */
export const ETIQUETA_DE_ACCION: Readonly<Record<string, string>> = {
  ingreso: 'Ingreso',
  ingreso_fallido: 'Ingreso fallido',
  ingreso_bloqueado: 'Ingreso bloqueado',
  cierre_sesion: 'Cierre de sesión',
  acceso_denegado: 'Acceso denegado',
  carga: 'Carga de documento',
  descarga: 'Descarga de documento',
  version: 'Versión nueva',
  restauracion: 'Restauración de versión',
  decision_duplicado: 'Decisión ante un duplicado',
  usuario_creado: 'Usuario creado',
  usuario_rol_cambiado: 'Rol de usuario cambiado',
  usuario_desactivado: 'Usuario desactivado',
  usuario_reactivado: 'Usuario reactivado',
  ccd_importado: 'Cuadro de clasificación importado',
  clave_cambiada: 'Clave cambiada',
  clave_restablecida: 'Clave restablecida',
};

/**
 * Las acciones que se ofrecen en el filtro: las del catálogo de la API en esta rama. Con una que la API no conozca, el
 * filtro responde 400 (`accion no es válida`); por eso no se ofrecen las que aún no están. Una prueba comprueba que cada una
 * existe en `acciones.ts`. [PENDIENTE] Al fusionar #19 y #51, agregar `ccd_importado`, `clave_cambiada` y `clave_restablecida`.
 */
export const ACCIONES_FILTRABLES: readonly string[] = [
  'ingreso',
  'ingreso_fallido',
  'ingreso_bloqueado',
  'cierre_sesion',
  'acceso_denegado',
  'carga',
  'descarga',
  'version',
  'restauracion',
  'decision_duplicado',
  'usuario_creado',
  'usuario_rol_cambiado',
  'usuario_desactivado',
  'usuario_reactivado',
];

export function etiquetaDeAccion(accion: string): string {
  return ETIQUETA_DE_ACCION[accion] ?? accion;
}

/** Lo que la guarda de roles de la API escribe: `GET /auditoria; requiere administrador; tiene consulta` (`roles.guard.ts`). */
const DETALLE_TECNICO_DE_ACCESO_DENEGADO = /^[A-Z]+ [^;]+; requiere [^;]+; tiene [^;]+$/;

export const TEXTO_DE_ACCESO_DENEGADO = 'Intentó hacer algo que su rol no permite; no se le concedió el acceso.';

/**
 * El detalle de un evento tal como lo ve la persona. El de `acceso_denegado` es texto de la guarda de roles (método y ruta de
 * la API, y el rol que hacía falta con el rol interno que tenía): sirve a quien depura la API, no a quien lee la auditoría, así
 * que aquí se dice con palabras. La API lo sigue guardando completo (ADR-003) y no se modifica. Un detalle de `acceso_denegado`
 * con otro formato, y el de cualquier otra acción, se muestran sin tocar: nunca se oculta lo que no se reconoce.
 */
export function detalleVisible(accion: string, detalle: string | null): string | null {
  if (accion === 'acceso_denegado' && detalle !== null && DETALLE_TECNICO_DE_ACCESO_DENEGADO.test(detalle)) {
    return TEXTO_DE_ACCESO_DENEGADO;
  }
  return detalle;
}

/**
 * Hora de Colombia (UTC-5, sin horario de verano): los eventos se muestran en esa hora (`formato.ts`), así que «el 22 de
 * noviembre» de quien filtra es de las 00:00 a las 23:59:59,999 de esa hora, no de las del servidor.
 */
const DESPLAZAMIENTO = '-05:00';

/** Primer instante del día `AAAA-MM-DD` en la hora de Colombia, en ISO 8601 con zona (UTC): lo que acepta `desde`. */
export function inicioDelDia(fecha: string): string {
  return new Date(`${fecha}T00:00:00.000${DESPLAZAMIENTO}`).toISOString();
}

/**
 * Último instante del día `AAAA-MM-DD` en la hora de Colombia: lo que acepta `hasta`. La API compara con `<=`, así que enviar
 * solo la fecha (medianoche UTC) dejaría fuera los eventos de ese mismo día.
 */
export function finDelDia(fecha: string): string {
  return new Date(`${fecha}T23:59:59.999${DESPLAZAMIENTO}`).toISOString();
}
