import { Inject, Injectable } from '@nestjs/common';
import { ENTORNO } from '../config/config.module.js';
import type { Entorno } from '../config/entorno.js';
import { firmaDesdeBytes, similitudDeFirmas } from '../similitud/firma.js';
import type { TextoDeVersion } from '../similitud/texto-pdf.js';
import { DocumentosRepository, type UbicacionDeVersion } from './documentos.repository.js';

/** Un documento que se parece al archivo que se está cargando. */
export interface Candidato extends UbicacionDeVersion {
  /** De 0 a 1. */
  similitud: number;
}

export interface Verificacion {
  /** Ya existe un archivo idéntico (misma huella SHA-256). */
  exacto: UbicacionDeVersion | undefined;
  /** Documentos distintos con un texto muy parecido, el más parecido primero. */
  probables: Candidato[];
}

/** Cuántos candidatos se muestran. Más que eso no ayuda a decidir. */
const MAXIMO_CANDIDATOS = 5;

/**
 * Verificación doble antes de guardar un documento nuevo: 1) huella exacta, 2) similitud de texto.
 * La similitud solo avisa; nunca decide. Actas, contratos y oficios comparten plantillas y pueden
 * parecerse mucho siendo distintos, así que la decisión es siempre de la persona.
 */
@Injectable()
export class DuplicadosService {
  constructor(
    @Inject(DocumentosRepository) private readonly repositorio: DocumentosRepository,
    @Inject(ENTORNO) private readonly entorno: Entorno,
  ) {}

  get umbral(): number {
    return this.entorno.UMBRAL_SIMILITUD;
  }

  async verificar(sha256: string, texto: TextoDeVersion): Promise<Verificacion> {
    const exacto = await this.repositorio.buscarPorHuella(sha256);
    // Un archivo idéntico ya se bloquea; sin texto solo se puede comparar por huella.
    if (exacto || texto.estado === 'sin_texto') return { exacto, probables: [] };

    const mia = firmaDesdeBytes(texto.firma);
    const mejorPorDocumento = new Map<number, Candidato>();
    for (const otra of await this.repositorio.firmasParaComparar()) {
      const similitud = similitudDeFirmas(mia, firmaDesdeBytes(otra.firma));
      if (similitud < this.entorno.UMBRAL_SIMILITUD) continue;
      const { firma: _firma, ...ubicacion } = otra;
      const previo = mejorPorDocumento.get(otra.documentoId);
      if (!previo || similitud > previo.similitud) {
        mejorPorDocumento.set(otra.documentoId, { ...ubicacion, similitud });
      }
    }
    const probables = [...mejorPorDocumento.values()]
      .sort((a, b) => b.similitud - a.similitud)
      .slice(0, MAXIMO_CANDIDATOS)
      // Dos decimales bastan para mostrarla; la firma estima con un error de unos 0,03.
      .map((c) => ({ ...c, similitud: Math.round(c.similitud * 100) / 100 }));
    return { exacto, probables };
  }
}
