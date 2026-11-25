import { screen } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import type { Candidato, DocumentoConVersiones, DocumentoCreado, VersionDetalle } from '../api/documentos';
import { archivoPdf, documentoDePrueba, respuestaJson } from './ayudas';

/** Ayudas de las pruebas de las pantallas de carga, versión nueva y duplicado (issue #24). Todo es ficticio. */

export function versionDePrueba(numero: number, cambios: Partial<VersionDetalle> = {}): VersionDetalle {
  return {
    numero,
    nombreOriginal: `contrato-v${numero}.pdf`,
    sha256: `${numero}`.padStart(64, 'b'),
    tamano: 2048 * numero,
    motivo: numero === 1 ? 'Carga inicial' : `Cambio ${numero}`,
    restauradaDe: null,
    textoEstado: 'ok',
    autorId: 2,
    autor: 'editor.demo',
    creadoEn: `2026-11-1${numero}T14:00:00.000Z`,
    ...cambios,
  };
}

/** El documento 7, «Contrato de obra 7», con dos versiones: el que «ya existe» en las pruebas de duplicado. */
export function documentoExistente(cambios: Partial<DocumentoConVersiones> = {}): DocumentoConVersiones {
  const { versionActual: _quitada, ...basico } = documentoDePrueba(7, {
    titulo: 'Contrato de obra 7',
    expediente: 'EXP-100',
    serieCodigo: '100-01',
    fechaDocumento: '2026-02-10',
  });
  return { ...basico, versiones: [versionDePrueba(2), versionDePrueba(1)], ...cambios };
}

export const CANDIDATO: Candidato = {
  documentoId: 7,
  version: 2,
  titulo: 'Contrato de obra 7',
  expediente: 'EXP-100',
  serieCodigo: '100-01',
  similitud: 0.93,
};

/** El cuerpo del 409 `duplicado_probable`. */
export function cuerpoDeProbable(candidatos: Candidato[] = [CANDIDATO]) {
  return {
    statusCode: 409,
    error: 'Conflict',
    message: 'Hay documentos con un texto muy parecido: puede ser un reescaneo. Reenvía el mismo archivo con decision=nueva_version y documentoId, o con decision=documento_distinto y justificacion',
    codigo: 'duplicado_probable',
    umbral: 0.8,
    candidatos,
  };
}

/** El cuerpo del 409 `duplicado_exacto`. */
export function cuerpoDeExacto() {
  return {
    statusCode: 409,
    error: 'Conflict',
    message: 'Ya existe un archivo idéntico: documento 7 («Contrato de obra 7»), versión 2',
    codigo: 'duplicado_exacto',
    existente: { documentoId: 7, version: 2, titulo: 'Contrato de obra 7', expediente: 'EXP-100', serieCodigo: '100-01' },
  };
}

/** El 201 de `POST /documentos` con el documento 31. */
export function respuestaDeCreado(cambios: Partial<DocumentoCreado> = {}): Response {
  const { versionActual: _quitada, ...basico } = documentoDePrueba(31, { titulo: 'Acta de comité 12' });
  return respuestaJson({ documento: basico, version: versionDePrueba(1), ...cambios }, 201);
}

export interface DatosDelFormulario {
  archivo?: File;
  titulo?: string;
  expediente?: string;
  /** El valor de la opción de subserie (el identificador). */
  serie?: string;
  fecha?: string;
  motivo?: string;
}

/** Llena el formulario de carga con datos válidos (cualquiera se puede cambiar). */
export async function llenarFormularioDeCarga(usuario: UserEvent, datos: DatosDelFormulario = {}) {
  await usuario.upload(screen.getByLabelText(/Archivo PDF/), datos.archivo ?? archivoPdf('escaneo-nuevo.pdf'));
  await usuario.type(screen.getByLabelText(/^Título/), datos.titulo ?? 'Contrato de obra reescaneado');
  await usuario.type(screen.getByLabelText(/^Expediente/), datos.expediente ?? 'EXP-2026-031');
  await usuario.selectOptions(screen.getByLabelText(/^Subserie/), datos.serie ?? '11');
  await usuario.type(screen.getByLabelText(/^Fecha del documento/), datos.fecha ?? '2026-03-15');
  if (datos.motivo) await usuario.type(screen.getByLabelText(/^Motivo de la carga/), datos.motivo);
}
