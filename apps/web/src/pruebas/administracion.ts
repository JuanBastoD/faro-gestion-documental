import type { EventoAuditoria, PaginaDeEventos } from '../api/auditoria';
import type { UsuarioAdministrado } from '../api/usuarios';

/**
 * Ayudas de las pruebas de las pantallas de usuarios y de auditoría (issue #25). Todo es ficticio: usuarios `*.demo`.
 *
 * Las claves de prueba son constantes con nombre y valores obviamente falsos y de baja entropía, definidas aquí una sola vez:
 * un literal con aspecto de secreto en una prueba lo marca gitleaks (`generic-api-key`) y obliga a ensuciar la lista de excepciones.
 */

/** Una clave inicial válida (14 caracteres, entre 12 y 256). */
export const CLAVE_INICIAL_DE_PRUEBA = 'x'.repeat(14);

/** Una de 11 caracteres: justo una menos que el mínimo. */
export const CLAVE_DEMASIADO_CORTA = 'x'.repeat(11);

/** Una de 12: justo el mínimo. */
export const CLAVE_DEL_MINIMO = 'x'.repeat(12);

/** Un usuario administrado. El id 1 es el administrador que tiene la sesión en las pruebas (`usuarioDePrueba('administrador')`). */
export function usuarioAdministrado(id: number, cambios: Partial<UsuarioAdministrado> = {}): UsuarioAdministrado {
  return {
    id,
    usuario: `persona${id}.demo`,
    nombre: `Persona Demo ${id}`,
    rol: 'consulta',
    activo: true,
    creadoEn: '2026-11-20T15:30:00.000Z',
    ...cambios,
  };
}

/** Cuatro usuarios: el administrador de la sesión (id 1), un editor, uno de consulta y uno inactivo. */
export function listaDeUsuarios(): UsuarioAdministrado[] {
  return [
    usuarioAdministrado(1, { usuario: 'administrador.demo', nombre: 'Admin Demo', rol: 'administrador' }),
    usuarioAdministrado(2, { usuario: 'editor.demo', nombre: 'Editor Demo', rol: 'editor' }),
    usuarioAdministrado(3, { usuario: 'consulta.demo', nombre: 'Consulta Demo', rol: 'consulta' }),
    usuarioAdministrado(4, { usuario: 'inactiva.demo', nombre: 'Persona Inactiva Demo', rol: 'consulta', activo: false }),
  ];
}

/** Un evento de auditoría de las 10:05:30 (hora de Colombia) del 23 de noviembre de 2026. */
export function eventoDePrueba(id: number, cambios: Partial<EventoAuditoria> = {}): EventoAuditoria {
  return {
    id,
    usuarioId: 2,
    usuario: 'editor.demo',
    accion: 'carga',
    documentoId: 12,
    detalle: 'Documento «Acta de comité 12»',
    creadoEn: '2026-11-23T15:05:30.000Z',
    ...cambios,
  };
}

export function paginaDeEventos(items: EventoAuditoria[], extra: Partial<PaginaDeEventos> = {}): PaginaDeEventos {
  return { items, total: items.length, pagina: 1, tamano: 20, ...extra };
}
