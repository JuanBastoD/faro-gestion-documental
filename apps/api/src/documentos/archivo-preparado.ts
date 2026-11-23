import { createHash } from 'node:crypto';
import { UnsupportedMediaTypeException } from '@nestjs/common';
import { esPdf, limpiarNombre } from './archivo-pdf.js';

export interface ArchivoRecibido {
  /** Nombre ya decodificado. */
  nombre: string;
  datos: Buffer;
}

export interface ArchivoPreparado {
  datos: Buffer;
  nombreOriginal: string;
  sha256: string;
  /** Clave del objeto en el almacén. */
  clave: string;
}

/** Clave del objeto: depende solo del contenido, así guardar el mismo archivo dos veces es inocuo. */
export const claveDeObjeto = (sha256: string) => `documentos/${sha256}.pdf`;

/** Comprueba que sea un PDF, calcula su huella y deja el nombre limpio. Lanza 415 si no es un PDF. */
export function prepararArchivo(archivo: ArchivoRecibido): ArchivoPreparado {
  if (!esPdf(archivo.datos)) {
    throw new UnsupportedMediaTypeException('El archivo no es un PDF');
  }
  const sha256 = createHash('sha256').update(archivo.datos).digest('hex');
  return {
    datos: archivo.datos,
    nombreOriginal: limpiarNombre(archivo.nombre),
    sha256,
    clave: claveDeObjeto(sha256),
  };
}
