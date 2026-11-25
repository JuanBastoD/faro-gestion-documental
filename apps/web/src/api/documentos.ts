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

// --- Carga, versión nueva, restauración y duplicados (issue #24) ------------------------------------------------

/**
 * Límites que fija la API (`apps/api/src/documentos/archivo-pdf.ts`, `datos-carga.ts` y `versiones.service.ts`). La
 * interfaz los repite solo para avisar antes de enviar un archivo de 25 MB; la API vuelve a validar todo y es la que
 * decide (no se confía en esta copia).
 */
export const TAMANO_MAXIMO_BYTES = 20 * 1024 * 1024;
export const LIMITES = { titulo: 200, expediente: 60, motivo: 300, justificacion: 500 } as const;

/** Lo que la persona decide ante un aviso de duplicado probable; son los únicos valores que acepta la API. */
export type Decision = 'nueva_version' | 'documento_distinto';

/** Lo que lleva `POST /documentos`. Con `decision` se reenvía el mismo archivo tras el aviso de duplicado. */
export interface DatosDeCarga {
  archivo: File;
  titulo: string;
  expediente: string;
  /** Una subserie: solo ellas admiten documentos. */
  serieId: number;
  /** `AAAA-MM-DD`. */
  fechaDocumento: string;
  /** Opcional en una carga inicial («Carga inicial» por defecto); obligatorio con `nueva_version`. */
  motivo?: string;
  decision?: Decision;
  /** Con `nueva_version`: el documento al que se agrega el archivo. */
  documentoId?: number;
  /** Con `documento_distinto`: por qué no es un duplicado. Queda en la auditoría. */
  justificacion?: string;
}

/**
 * El formulario multipart de `POST /documentos`. Solo se envían los campos que la API admite para cada caso: ella
 * rechaza con 400 un `documentoId` fuera de `nueva_version` o una `justificacion` fuera de `documento_distinto`.
 * El archivo va al final: los campos de texto llegan primero al servidor.
 */
export function formularioDeCarga(datos: DatosDeCarga): FormData {
  const formulario = new FormData();
  formulario.set('titulo', datos.titulo.trim());
  formulario.set('expediente', datos.expediente.trim());
  formulario.set('serieId', String(datos.serieId));
  formulario.set('fechaDocumento', datos.fechaDocumento);
  const motivo = datos.motivo?.trim();
  if (motivo) formulario.set('motivo', motivo);
  if (datos.decision) {
    formulario.set('decision', datos.decision);
    if (datos.decision === 'nueva_version' && datos.documentoId !== undefined) {
      formulario.set('documentoId', String(datos.documentoId));
    }
    const justificacion = datos.justificacion?.trim();
    if (datos.decision === 'documento_distinto' && justificacion) formulario.set('justificacion', justificacion);
  }
  formulario.set('archivo', datos.archivo, datos.archivo.name);
  return formulario;
}

/**
 * `POST /documentos`: carga un documento nuevo con su primera versión. 409 `duplicado_exacto` (el archivo ya existe, no
 * se puede cargar) o `duplicado_probable` (texto muy parecido: hay que reenviar con una `decision`).
 */
export function cargarDocumento(datos: DatosDeCarga, senal?: AbortSignal): Promise<DocumentoCreado> {
  return pedir<DocumentoCreado>('/documentos', { metodo: 'POST', formulario: formularioDeCarga(datos), senal });
}

/**
 * `POST /documentos/:id/versiones`: sube una versión nueva. El motivo es obligatorio (hasta 300 caracteres). 409 si el
 * contenido ya está en una versión de ese documento.
 */
export function agregarVersion(
  documentoId: number,
  archivo: File,
  motivo: string,
  senal?: AbortSignal,
): Promise<VersionDetalle> {
  const formulario = new FormData();
  formulario.set('motivo', motivo.trim());
  formulario.set('archivo', archivo, archivo.name);
  return pedir<VersionDetalle>(`/documentos/${documentoId}/versiones`, { metodo: 'POST', formulario, senal });
}

/**
 * `POST /documentos/:id/versiones/:n/restaurar`: crea una versión NUEVA con el contenido de la `n`; no edita ni borra nada.
 * El motivo es opcional («Restaura la versión n» por defecto). 409 si la vigente ya tiene ese contenido.
 */
export function restaurarVersion(
  documentoId: number,
  numero: number,
  motivo: string,
  senal?: AbortSignal,
): Promise<VersionDetalle> {
  const texto = motivo.trim();
  return pedir<VersionDetalle>(`/documentos/${documentoId}/versiones/${numero}/restaurar`, {
    metodo: 'POST',
    cuerpo: texto === '' ? {} : { motivo: texto },
    senal,
  });
}

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
