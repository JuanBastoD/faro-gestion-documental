import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';
import { Inject, Injectable } from '@nestjs/common';
import { DB, type BaseDatos } from '../base-datos/base-datos.module.js';
import { documentos, seriesCcd, usuarios, versiones } from '../base-datos/esquema.js';

/** Transacción abierta por `enTransaccion`. También sirve como ejecutor de inserciones de auditoría. */
export type Transaccion = Parameters<Parameters<BaseDatos['transaction']>[0]>[0];

/** Algo contra lo que se puede consultar: la base o una transacción abierta. */
export type Ejecutor = BaseDatos | Transaccion;

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
  /** Número de la versión que esta restaura, si es una restauración. */
  restauradaDe?: number;
  autorId: number;
  /** `sin_texto` si no se pudo extraer texto suficiente del PDF. */
  textoEstado: 'ok' | 'sin_texto';
  textoNormalizado: string | null;
  firma: Buffer | null;
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
  restauradaDe: number | null;
  /** `sin_texto`: solo se verificó por huella exacta (sin capa de texto o no legible). */
  textoEstado: string;
  autorId: number;
  autor: string;
  creadoEn: Date;
}

/** Todo lo que hace falta para restaurar o comparar una versión. */
export interface VersionCompleta {
  numero: number;
  archivo: string;
  nombreOriginal: string;
  sha256: string;
  tamano: number;
}

export interface ResumenDocumento extends DocumentoBasico {
  /** Número de la versión más reciente. */
  versionActual: number;
}

/** Dónde está una versión: lo que se muestra al avisar de un duplicado. */
export interface UbicacionDeVersion {
  documentoId: number;
  version: number;
  titulo: string;
  expediente: string;
  serieCodigo: string;
}

export interface TextoGuardado {
  textoEstado: 'ok' | 'sin_texto';
  textoNormalizado: string | null;
  firma: Buffer | null;
}

const columnasUbicacion = {
  documentoId: versiones.documentoId,
  version: versiones.numero,
  titulo: documentos.titulo,
  expediente: documentos.expediente,
  serieCodigo: seriesCcd.codigo,
};

const columnasCompletas = {
  numero: versiones.numero,
  archivo: versiones.archivo,
  nombreOriginal: versiones.nombreOriginal,
  sha256: versiones.sha256,
  tamano: versiones.tamano,
};

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

  /** El texto y la firma de una versión, para copiarlos al restaurarla. */
  async buscarTexto(
    tx: Transaccion,
    documentoId: number,
    numero: number,
  ): Promise<TextoGuardado | undefined> {
    const [fila] = await tx
      .select({
        textoEstado: versiones.textoEstado,
        textoNormalizado: versiones.textoNormalizado,
        firma: versiones.firma,
      })
      .from(versiones)
      .where(and(eq(versiones.documentoId, documentoId), eq(versiones.numero, numero)))
      .limit(1);
    return fila && { ...fila, textoEstado: fila.textoEstado === 'ok' ? 'ok' : 'sin_texto' };
  }

  /**
   * Bloquea (hasta el fin de la transacción) a quien quiera cargar un archivo con esta huella.
   * Dos cargas idénticas simultáneas se ponen en fila y la segunda ve a la primera al volver a
   * verificar, así que no pueden quedar los dos documentos.
   */
  async bloquearHuella(tx: Transaccion, sha256: string): Promise<void> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${sha256}, 0))`);
  }

  /** La versión más antigua de cualquier documento con esa huella exacta, con dónde está. */
  async buscarPorHuella(
    sha256: string,
    ejecutor: Ejecutor = this.db,
  ): Promise<UbicacionDeVersion | undefined> {
    const [fila] = await ejecutor
      .select(columnasUbicacion)
      .from(versiones)
      .innerJoin(documentos, eq(documentos.id, versiones.documentoId))
      .innerJoin(seriesCcd, eq(seriesCcd.id, documentos.serieId))
      .where(eq(versiones.sha256, sha256))
      .orderBy(versiones.creadoEn, versiones.id)
      .limit(1);
    return fila;
  }

  /**
   * Firma de todas las versiones con texto y contenido propio (las restauraciones repiten la firma
   * de otra versión y se dejan fuera). Con las cantidades de la entidad caben en memoria: 1 KB cada una.
   */
  async firmasParaComparar(): Promise<Array<UbicacionDeVersion & { firma: Buffer }>> {
    const filas = await this.db
      .select({ ...columnasUbicacion, firma: versiones.firma })
      .from(versiones)
      .innerJoin(documentos, eq(documentos.id, versiones.documentoId))
      .innerJoin(seriesCcd, eq(seriesCcd.id, documentos.serieId))
      .where(and(eq(versiones.textoEstado, 'ok'), isNull(versiones.restauradaDe)));
    return filas.flatMap((fila) => (fila.firma ? [{ ...fila, firma: fila.firma }] : []));
  }

  /** ¿Existe el documento? Barato: sirve para fallar con 404 antes de guardar un archivo. */
  async existeDocumento(id: number): Promise<boolean> {
    const [fila] = await this.db
      .select({ id: documentos.id })
      .from(documentos)
      .where(eq(documentos.id, id))
      .limit(1);
    return fila !== undefined;
  }

  /**
   * Bloquea la fila del documento hasta el fin de la transacción: dos versiones simultáneas del
   * mismo documento se ponen en fila y la numeración no se repite ni deja huecos.
   * Devuelve false si el documento no existe.
   */
  async bloquearDocumento(tx: Transaccion, id: number): Promise<boolean> {
    const filas = await tx
      .select({ id: documentos.id })
      .from(documentos)
      .where(eq(documentos.id, id))
      .for('update');
    return filas.length > 0;
  }

  /** La versión vigente es la de número más alto. Undefined si el documento no tiene versiones. */
  async versionVigente(tx: Transaccion, documentoId: number): Promise<VersionCompleta | undefined> {
    const [fila] = await tx
      .select(columnasCompletas)
      .from(versiones)
      .where(eq(versiones.documentoId, documentoId))
      .orderBy(desc(versiones.numero))
      .limit(1);
    return fila;
  }

  /** Número de la versión con esa huella entre las de contenido nuevo (no restauraciones). */
  async numeroConHuella(
    tx: Transaccion,
    documentoId: number,
    sha256: string,
  ): Promise<number | undefined> {
    const [fila] = await tx
      .select({ numero: versiones.numero })
      .from(versiones)
      .where(
        and(
          eq(versiones.documentoId, documentoId),
          eq(versiones.sha256, sha256),
          isNull(versiones.restauradaDe),
        ),
      )
      .limit(1);
    return fila?.numero;
  }

  async buscarVersionCompleta(
    tx: Transaccion,
    documentoId: number,
    numero: number,
  ): Promise<VersionCompleta | undefined> {
    const [fila] = await tx
      .select(columnasCompletas)
      .from(versiones)
      .where(and(eq(versiones.documentoId, documentoId), eq(versiones.numero, numero)))
      .limit(1);
    return fila;
  }

  /** Una sola versión con su autor, para devolverla tras crearla. */
  async detalleDeVersion(documentoId: number, numero: number): Promise<VersionDetalle | undefined> {
    const todas = await this.listarVersiones(documentoId);
    return todas.find((v) => v.numero === numero);
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
        restauradaDe: versiones.restauradaDe,
        textoEstado: versiones.textoEstado,
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
