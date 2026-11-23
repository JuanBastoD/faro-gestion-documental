import { pedir } from './cliente';

export interface EventoAuditoria {
  id: number;
  /** Quién actuó. Nulo si no se pudo identificar (un ingreso fallido, por ejemplo). */
  usuarioId: number | null;
  /** Nombre de usuario de quien actuó, si se conoce. */
  usuario: string | null;
  /**
   * Acción registrada (`ingreso`, `carga`, `descarga`...). Es texto libre aquí a propósito: el catálogo vive en
   * `apps/api/src/auditoria/acciones.ts` y crece con la API.
   */
  accion: string;
  documentoId: number | null;
  detalle: string | null;
  creadoEn: string;
}

export interface PaginaDeEventos {
  items: EventoAuditoria[];
  total: number;
  pagina: number;
  tamano: number;
}

/** Parámetros de `GET /auditoria`. Fechas ISO 8601. `tamano` va de 1 a 100 (20 por defecto). */
export interface FiltrosDeAuditoria {
  usuarioId?: number;
  accion?: string;
  documentoId?: number;
  desde?: string;
  hasta?: string;
  pagina?: number;
  tamano?: number;
}

/** `GET /auditoria` (administrador): los eventos más recientes primero. Solo lectura. */
export function consultarAuditoria(filtros: FiltrosDeAuditoria = {}, senal?: AbortSignal): Promise<PaginaDeEventos> {
  return pedir<PaginaDeEventos>('/auditoria', { consulta: { ...filtros }, senal });
}
