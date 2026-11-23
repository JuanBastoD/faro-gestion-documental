import { and, count, desc, eq, sql } from 'drizzle-orm';
import { Inject, Injectable } from '@nestjs/common';
import { DB, type BaseDatos } from '../base-datos/base-datos.module.js';
import { documentos, seriesCcd, usuarios, versiones } from '../base-datos/esquema.js';

/** Transacción abierta por `enTransaccion`. También sirve como ejecutor de inserciones de auditoría. */
export type Transaccion = Parameters<Parameters<BaseDatos['transaction']>[0]>[0];

export interface NuevoDocumento {
  titulo: string;
  expediente: string;
  serieId: number;
  fechaDocumento: string;
  creadoPor: number;
}

export interface NuevaVersion {
  documentoId: number;
  numero: number;
  archivo: string;
  nombreOriginal: string;
  sha256: string;
  tamano: number;
  motivo: string;
  autorId: number;
}

export interface DocumentoBasico {
  id: number;
  titulo: string;
  expediente: string;
  serieId: number;
  serieCodigo: string;
  fechaDocumento: string;
  creadoPor: number;
  creadoEn: Date;
}

export interface VersionDetalle {
  numero: number;
  nombreOriginal: string;
  sha256: string;
  tamano: number;
  motivo: string;
  autorId: number;
  autor: string;
  creadoEn: Date;
}

export interface ResumenDocumento extends DocumentoBasico {
  /** Número de la versión más reciente. */
  versionActual: number;
}

@Injectable()
export class DocumentosRepository {
  constructor(@Inject(DB) private readonly db: BaseDatos) {}

  enTransaccion<T>(trabajo: (tx: Transaccion) => Promise<T>): Promise<T> {
    return this.db.transaction(trabajo);
  }

  async insertarDocumento(tx: Transaccion, datos: NuevoDocumento): Promise<number> {
    const [fila] = await tx.insert(documentos).values(datos).returning({ id: documentos.id });
    return fila.id;
  }

  async insertarVersion(tx: Transaccion, datos: NuevaVersion): Promise<void> {
    await tx.insert(versiones).values(datos);
  }

  /** ¿Alguna versión usa este objeto? Para no borrar un archivo que otro registro necesita. */
  async objetoReferenciado(clave: string): Promise<boolean> {
    const [fila] = await this.db
      .select({ n: count() })
      .from(versiones)
      .where(eq(versiones.archivo, clave));
    return fila.n > 0;
  }

  /** Todas las claves de objeto que alguna versión usa. Para detectar archivos huérfanos. */
  async clavesReferenciadas(): Promise<Set<string>> {
    const filas = await this.db.selectDistinct({ archivo: versiones.archivo }).from(versiones);
    return new Set(filas.map((f) => f.archivo));
  }

  async buscarDocumento(id: number): Promise<DocumentoBasico | undefined> {
    const [fila] = await this.db
      .select({
        id: documentos.id,
        titulo: documentos.titulo,
        expediente: documentos.expediente,
        serieId: documentos.serieId,
        serieCodigo: seriesCcd.codigo,
        fechaDocumento: documentos.fechaDocumento,
        creadoPor: documentos.creadoPor,
        creadoEn: documentos.creadoEn,
      })
      .from(documentos)
      .innerJoin(seriesCcd, eq(seriesCcd.id, documentos.serieId))
      .where(eq(documentos.id, id))
      .limit(1);
    return fila;
  }

  /** Más reciente primero. */
  listarVersiones(documentoId: number): Promise<VersionDetalle[]> {
    return this.db
      .select({
        numero: versiones.numero,
        nombreOriginal: versiones.nombreOriginal,
        sha256: versiones.sha256,
        tamano: versiones.tamano,
        motivo: versiones.motivo,
        autorId: versiones.autorId,
        autor: usuarios.usuario,
        creadoEn: versiones.creadoEn,
      })
      .from(versiones)
      .innerJoin(usuarios, eq(usuarios.id, versiones.autorId))
      .where(eq(versiones.documentoId, documentoId))
      .orderBy(desc(versiones.numero));
  }

  async buscarVersion(
    documentoId: number,
    numero: number,
  ): Promise<{ archivo: string; nombreOriginal: string } | undefined> {
    const [fila] = await this.db
      .select({ archivo: versiones.archivo, nombreOriginal: versiones.nombreOriginal })
      .from(versiones)
      .where(and(eq(versiones.documentoId, documentoId), eq(versiones.numero, numero)))
      .limit(1);
    return fila;
  }

  /** Listado simple, el más reciente primero. La búsqueda por texto llega en #13. */
  async listarDocumentos(
    pagina: number,
    tamano: number,
  ): Promise<{ items: ResumenDocumento[]; total: number }> {
    const items = await this.db
      .select({
        id: documentos.id,
        titulo: documentos.titulo,
        expediente: documentos.expediente,
        serieId: documentos.serieId,
        serieCodigo: seriesCcd.codigo,
        fechaDocumento: documentos.fechaDocumento,
        creadoPor: documentos.creadoPor,
        creadoEn: documentos.creadoEn,
        versionActual: sql<number>`(select max(${versiones.numero}) from ${versiones} where ${versiones.documentoId} = ${documentos.id})`
          .mapWith(Number)
          .as('version_actual'),
      })
      .from(documentos)
      .innerJoin(seriesCcd, eq(seriesCcd.id, documentos.serieId))
      .orderBy(desc(documentos.creadoEn), desc(documentos.id))
      .limit(tamano)
      .offset((pagina - 1) * tamano);
    const [{ total }] = await this.db.select({ total: count() }).from(documentos);
    return { items, total };
  }
}
