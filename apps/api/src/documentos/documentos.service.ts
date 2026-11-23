import { createHash } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnsupportedMediaTypeException,
  BadRequestException,
} from '@nestjs/common';
import { ACCION } from '../auditoria/acciones.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { ALMACEN, ObjetoNoEncontradoError, type AlmacenArchivos } from '../almacen/almacen-archivos.js';
import type { UsuarioSesion } from '../auth/roles.js';
import { SeriesService } from '../ccd/series.service.js';
import { esPdf, limpiarNombre } from './archivo-pdf.js';
import { leerDatosCarga } from './datos-carga.js';
import {
  DocumentosRepository,
  type DocumentoBasico,
  type ResumenDocumento,
  type VersionDetalle,
} from './documentos.repository.js';

export interface ArchivoRecibido {
  /** Nombre ya decodificado. */
  nombre: string;
  datos: Buffer;
}

export interface DocumentoCreado {
  documento: DocumentoBasico;
  version: VersionDetalle;
}

export interface DocumentoConVersiones extends DocumentoBasico {
  versiones: VersionDetalle[];
}

export interface PaginaDeDocumentos {
  items: ResumenDocumento[];
  total: number;
  pagina: number;
  tamano: number;
}

/** Clave del objeto: depende solo del contenido, así guardar el mismo archivo dos veces es inocuo. */
export const claveDeObjeto = (sha256: string) => `documentos/${sha256}.pdf`;

@Injectable()
export class DocumentosService {
  private readonly logger = new Logger(DocumentosService.name);

  constructor(
    @Inject(DocumentosRepository) private readonly repositorio: DocumentosRepository,
    @Inject(ALMACEN) private readonly almacen: AlmacenArchivos,
    @Inject(SeriesService) private readonly series: SeriesService,
    @Inject(AuditoriaService) private readonly auditoria: AuditoriaService,
  ) {}

  /**
   * Carga un documento nuevo con su primera versión.
   *
   * Sin estados a medias: el objeto se guarda primero, con una clave derivada de su huella, y
   * después el documento, la versión y el evento de auditoría se insertan en UNA transacción.
   * Si la transacción falla se borra el objeto, salvo que otra versión ya lo use. Si el proceso
   * muere entre los dos pasos queda un objeto huérfano, que `npm run almacen:huerfanos` encuentra.
   */
  async cargar(
    cuerpo: unknown,
    archivo: ArchivoRecibido | undefined,
    usuario: UsuarioSesion,
  ): Promise<DocumentoCreado> {
    const datos = leerDatosCarga(cuerpo);
    if (!archivo) {
      throw new BadRequestException('Falta el archivo PDF (campo "archivo")');
    }
    if (!esPdf(archivo.datos)) {
      throw new UnsupportedMediaTypeException('El archivo no es un PDF');
    }
    await this.series.exigirSubserie(datos.serieId);

    const sha256 = createHash('sha256').update(archivo.datos).digest('hex');
    const clave = claveDeObjeto(sha256);
    const nombreOriginal = limpiarNombre(archivo.nombre);

    await this.almacen.guardar(clave, archivo.datos, 'application/pdf');
    try {
      const documentoId = await this.repositorio.enTransaccion(async (tx) => {
        const id = await this.repositorio.insertarDocumento(tx, {
          titulo: datos.titulo,
          expediente: datos.expediente,
          serieId: datos.serieId,
          fechaDocumento: datos.fechaDocumento,
          creadoPor: usuario.id,
        });
        await this.repositorio.insertarVersion(tx, {
          documentoId: id,
          numero: 1,
          archivo: clave,
          nombreOriginal,
          sha256,
          tamano: archivo.datos.length,
          motivo: datos.motivo,
          autorId: usuario.id,
        });
        await this.auditoria.registrar(
          {
            usuarioId: usuario.id,
            accion: ACCION.CARGA,
            documentoId: id,
            detalle: `versión 1; sha256 ${sha256.slice(0, 12)}`,
          },
          tx,
        );
        return id;
      });
      return await this.detalleDeCarga(documentoId);
    } catch (error) {
      await this.compensar(clave);
      throw error;
    }
  }

  async obtener(id: number): Promise<DocumentoConVersiones> {
    const documento = await this.repositorio.buscarDocumento(id);
    if (!documento) throw new NotFoundException(`No existe el documento ${id}`);
    return { ...documento, versiones: await this.repositorio.listarVersiones(id) };
  }

  async listar(pagina: number, tamano: number): Promise<PaginaDeDocumentos> {
    const { items, total } = await this.repositorio.listarDocumentos(pagina, tamano);
    return { items, total, pagina, tamano };
  }

  /** Lee el archivo de una versión y deja el evento `descarga`. */
  async descargar(
    documentoId: number,
    numero: number,
    usuario: UsuarioSesion,
  ): Promise<{ datos: Buffer; nombre: string }> {
    const version = await this.repositorio.buscarVersion(documentoId, numero);
    if (!version) {
      throw new NotFoundException(`No existe la versión ${numero} del documento ${documentoId}`);
    }
    let datos: Buffer;
    try {
      datos = await this.almacen.leer(version.archivo);
    } catch (error) {
      if (error instanceof ObjetoNoEncontradoError) {
        // El registro existe pero el archivo no: es una inconsistencia que alguien debe ver.
        this.logger.error(
          `Falta el objeto ${version.archivo} del documento ${documentoId}, versión ${numero}`,
        );
        throw new NotFoundException('El archivo de esta versión no está disponible');
      }
      throw error;
    }
    await this.auditoria.registrar({
      usuarioId: usuario.id,
      accion: ACCION.DESCARGA,
      documentoId,
      detalle: `versión ${numero}`,
    });
    return { datos, nombre: version.nombreOriginal };
  }

  private async detalleDeCarga(documentoId: number): Promise<DocumentoCreado> {
    const { versiones, ...documento } = await this.obtener(documentoId);
    return { documento, version: versiones[0] };
  }

  /** Borra el objeto de una carga fallida, salvo que otro registro lo use. Un fallo aquí no tapa el error original. */
  private async compensar(clave: string): Promise<void> {
    try {
      if (!(await this.repositorio.objetoReferenciado(clave))) {
        await this.almacen.borrar(clave);
      }
    } catch (error) {
      this.logger.error(
        `No se pudo limpiar el objeto ${clave} tras una carga fallida; quedará como huérfano: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
