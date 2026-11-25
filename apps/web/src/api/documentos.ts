import { pedir } from './cliente';

/**
 * Tipos de `apps/api/src/documentos/*`. Las fechas con hora llegan como texto ISO 8601 (JSON no tiene fechas);
 * `fechaDocumento` es solo calendario (`AAAA-MM-DD`).
 */

export interface DocumentoBasico {
  id: number;
  titulo: string;
  expediente: string;
  /** Siempre una subserie: solo ellas admiten documentos. */
  serieId: number;
  serieCodigo: string;
  fechaDocumento: string;
  creadoPor: number;
  creadoEn: string;
}

/** Un elemento del listado. */
export interface ResumenDocumento extends DocumentoBasico {
  /** Número de la versión más reciente. */
  versionActual: number;
}

export interface PaginaDeDocumentos {
  items: ResumenDocumento[];
  total: number;
  pagina: number;
  tamano: number;
}

export interface VersionDetalle {
  numero: number;
  nombreOriginal: string;
  sha256: string;
  /** Bytes. */
  tamano: number;
  motivo: string;
  /** Número de la versión de la que esta es restauración, si lo es. */
  restauradaDe: number | null;
  /** `sin_texto`: solo se verificó por huella exacta (sin capa de texto o no legible). */
  textoEstado: string;
  autorId: number;
  /** Nombre de usuario del autor. */
  autor: string;
  creadoEn: string;
}

/** `GET /documentos/:id`: el documento con su historial, la versión más reciente primero. */
export interface DocumentoConVersiones extends DocumentoBasico {
  versiones: VersionDetalle[];
}

/** Parámetros de `GET /documentos`. `tamano` va de 1 a 50 (20 por defecto). */
export interface ConsultaDeDocumentos {
  q?: string;
  /** Una serie o subserie; con una serie incluye los documentos de sus subseries. */
  serieId?: number;
  pagina?: number;
  tamano?: number;
}

/** `GET /documentos`: listado y búsqueda (ADR-007). Sin `q`, el más reciente primero. */
export function listarDocumentos(consulta: ConsultaDeDocumentos, senal?: AbortSignal): Promise<PaginaDeDocumentos> {
  return pedir<PaginaDeDocumentos>('/documentos', {
    consulta: { q: consulta.q, serieId: consulta.serieId, pagina: consulta.pagina, tamano: consulta.tamano },
    senal,
  });
}

/** `GET /documentos/:id`. 404 si no existe. */
export function obtenerDocumento(id: number, senal?: AbortSignal): Promise<DocumentoConVersiones> {
  return pedir<DocumentoConVersiones>(`/documentos/${id}`, { senal });
}

/**
 * Dirección de la descarga de una versión (`GET /documentos/:id/versiones/:n/archivo`). Responde el PDF con
 * `Content-Disposition: attachment` y deja el evento `descarga` en la auditoría, así que se usa como enlace
 * normal: el navegador manda la cookie solo.
 */
export function urlDeArchivo(documentoId: number, numeroDeVersion: number): string {
  return `/documentos/${documentoId}/versiones/${numeroDeVersion}/archivo`;
}

// --- Para #24 (carga, versión y duplicado): tipos de lo que devuelve la API, todavía sin pantalla -----------------

/** Dónde está una versión; es lo que se muestra al avisar de un duplicado. */
export interface UbicacionDeVersion {
  documentoId: number;
  version: number;
  titulo: string;
  expediente: string;
  serieCodigo: string;
}

/** Un documento con texto parecido al archivo que se carga. */
export interface Candidato extends UbicacionDeVersion {
  /** De 0 a 1. */
  similitud: number;
}

/** 201 de `POST /documentos`. */
export interface DocumentoCreado {
  documento: DocumentoBasico;
  version: VersionDetalle;
}

/**
 * Cuerpo del 409 de `POST /documentos`: `codigo: 'duplicado_exacto'` trae `existente`; `codigo: 'duplicado_probable'`
 * trae `umbral` y `candidatos`. Se lee de `ErrorApi.cuerpo`.
 */
export type ConflictoDeDuplicado =
  | { codigo: 'duplicado_exacto'; message: string; existente: UbicacionDeVersion }
  | { codigo: 'duplicado_probable'; message: string; umbral: number; candidatos: Candidato[] };
