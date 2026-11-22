import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ACCION } from '../auditoria/acciones.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { ALMACEN, ObjetoNoEncontradoError, type AlmacenArchivos } from '../almacen/almacen-archivos.js';
import type { UsuarioSesion } from '../auth/roles.js';
import { SeriesService } from '../ccd/series.service.js';
import { prepararArchivo, type ArchivoPreparado, type ArchivoRecibido } from './archivo-preparado.js';
import { compensarObjeto } from './compensar-objeto.js';
import { extraerTexto, type TextoDeVersion } from '../similitud/texto-pdf.js';
import {
  DECISION_NUEVA_VERSION,
  leerDatosCarga,
  motivoDe,
  type DatosCarga,
} from './datos-carga.js';
import { DuplicadosService, type Candidato } from './duplicados.service.js';
import {
  DocumentosRepository,
  type DocumentoBasico,
  type FiltroDeDocumentos,
  type ResumenDocumento,
  type Transaccion,
  type UbicacionDeVersion,
  type VersionDetalle,
} from './documentos.repository.js';
import { VersionesService } from './versiones.service.js';

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

@Injectable()
export class DocumentosService {
  private readonly logger = new Logger(DocumentosService.name);

  constructor(
    @Inject(DocumentosRepository) private readonly repositorio: DocumentosRepository,
    @Inject(ALMACEN) private readonly almacen: AlmacenArchivos,
    @Inject(SeriesService) private readonly series: SeriesService,
    @Inject(AuditoriaService) private readonly auditoria: AuditoriaService,
    @Inject(DuplicadosService) private readonly duplicados: DuplicadosService,
    @Inject(VersionesService) private readonly versiones: VersionesService,
  ) {}

  /**
   * Carga un documento nuevo con su primera versión, tras la verificación doble:
   *  1. Huella SHA-256 igual a la de un archivo que ya existe: 409 `duplicado_exacto`, con dónde está.
   *  2. Huella distinta pero texto muy parecido (reescaneo probable): 409 `duplicado_probable` con los
   *     candidatos. La persona reenvía el archivo con `decision=nueva_version` (y `documentoId`) o
   *     `decision=documento_distinto` (y `justificacion`). La similitud nunca bloquea sola.
   *  3. PDF sin capa de texto: se marca `sin_texto` y solo cuenta la huella.
   * Cada decisión queda en la auditoría (`decision_duplicado`), en la misma transacción.
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
    const preparado = prepararArchivo(archivo);
    await this.series.exigirSubserie(datos.serieId);

    const texto = await extraerTexto(archivo.datos);
    const { exacto, probables } = await this.duplicados.verificar(preparado.sha256, texto);
    if (exacto) throw this.duplicadoExacto(exacto);
    if (!datos.decision && probables.length > 0) throw this.duplicadoProbable(probables);

    if (datos.decision === DECISION_NUEVA_VERSION && datos.documentoId !== undefined) {
      return this.cargarComoNuevaVersion(datos, datos.documentoId, archivo, texto, probables, usuario);
    }
    return this.crearDocumento(datos, preparado, texto, probables, usuario);
  }

  private async crearDocumento(
    datos: DatosCarga,
    preparado: ArchivoPreparado,
    texto: TextoDeVersion,
    probables: Candidato[],
    usuario: UsuarioSesion,
  ): Promise<DocumentoCreado> {
    const { sha256, clave, nombreOriginal } = preparado;
    await this.almacen.guardar(clave, preparado.datos, 'application/pdf');
    try {
      const documentoId = await this.repositorio.enTransaccion(async (tx) => {
        // Verificación final bajo bloqueo: otra carga idéntica pudo terminar desde la primera comprobación.
        await this.repositorio.bloquearHuella(tx, sha256);
        const yaExiste = await this.repositorio.buscarPorHuella(sha256, tx);
        if (yaExiste) throw this.duplicadoExacto(yaExiste);

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
          tamano: preparado.datos.length,
          motivo: motivoDe(datos),
          autorId: usuario.id,
          textoEstado: texto.estado,
          textoNormalizado: texto.textoNormalizado,
          firma: texto.firma,
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
        if (datos.decision) {
          await this.registrarDecision(tx, usuario, id, datos, probables);
        }
        await this.repositorio.actualizarBusqueda(tx, id);
        return id;
      });
      return await this.detalleDeCarga(documentoId);
    } catch (error) {
      await compensarObjeto(clave, this.repositorio, this.almacen, this.logger);
      throw error;
    }
  }

  /** La persona decidió que el archivo es una versión nueva de un documento que ya existe. */
  private async cargarComoNuevaVersion(
    datos: DatosCarga,
    documentoId: number,
    archivo: ArchivoRecibido,
    texto: TextoDeVersion,
    probables: Candidato[],
    usuario: UsuarioSesion,
  ): Promise<DocumentoCreado> {
    const version = await this.versiones.agregar(
      documentoId,
      { motivo: datos.motivo },
      archivo,
      usuario,
      {
        texto,
        alRegistrar: (tx) => this.registrarDecision(tx, usuario, documentoId, datos, probables),
      },
    );
    const { versiones: _historial, ...documento } = await this.obtener(documentoId);
    return { documento, version };
  }

  /** Deja en la auditoría qué decidió la persona ante el aviso y entre qué candidatos. */
  private registrarDecision(
    tx: Transaccion,
    usuario: UsuarioSesion,
    documentoId: number,
    datos: DatosCarga,
    probables: Candidato[],
  ): Promise<void> {
    const candidatos =
      probables.length === 0
        ? 'sin candidatos'
        : probables.map((c) => `${c.documentoId} v${c.version} (${c.similitud.toFixed(2)})`).join(', ');
    const detalle =
      datos.decision === DECISION_NUEVA_VERSION
        ? `nueva_version del documento ${documentoId}; candidatos: ${candidatos}`
        : `documento_distinto; candidatos: ${candidatos}; justificación: ${datos.justificacion ?? ''}`;
    return this.auditoria.registrar(
      { usuarioId: usuario.id, accion: ACCION.DECISION_DUPLICADO, documentoId, detalle },
      tx,
    );
  }

  private duplicadoExacto(existente: UbicacionDeVersion): ConflictException {
    return new ConflictException({
      statusCode: 409,
      error: 'Conflict',
      message: `Ya existe un archivo idéntico: documento ${existente.documentoId} («${existente.titulo}»), versión ${existente.version}`,
      codigo: 'duplicado_exacto',
      existente,
    });
  }

  private duplicadoProbable(candidatos: Candidato[]): ConflictException {
    return new ConflictException({
      statusCode: 409,
      error: 'Conflict',
      message:
        'Hay documentos con un texto muy parecido: puede ser un reescaneo. Reenvía el mismo archivo con ' +
        'decision=nueva_version y documentoId, o con decision=documento_distinto y justificacion',
      codigo: 'duplicado_probable',
      umbral: this.duplicados.umbral,
      candidatos,
    });
  }

  async obtener(id: number): Promise<DocumentoConVersiones> {
    const documento = await this.repositorio.buscarDocumento(id);
    if (!documento) throw new NotFoundException(`No existe el documento ${id}`);
    return { ...documento, versiones: await this.repositorio.listarVersiones(id) };
  }

  async listar(
    pagina: number,
    tamano: number,
    filtro: FiltroDeDocumentos = {},
  ): Promise<PaginaDeDocumentos> {
    const { items, total } = await this.repositorio.listarDocumentos(pagina, tamano, filtro);
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
}
