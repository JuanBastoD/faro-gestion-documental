import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import { ACCION } from '../auditoria/acciones.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { ALMACEN, type AlmacenArchivos } from '../almacen/almacen-archivos.js';
import type { UsuarioSesion } from '../auth/roles.js';
import { prepararArchivo, type ArchivoRecibido } from './archivo-preparado.js';
import { compensarObjeto } from './compensar-objeto.js';
import { DatosInvalidosError } from './datos-carga.js';
import { DocumentosRepository, type Transaccion, type VersionDetalle } from './documentos.repository.js';
import { extraerTexto, type TextoDeVersion } from '../similitud/texto-pdf.js';

const MOTIVO_MAXIMO = 300;

const esquemaNuevaVersion = z.object({
  motivo: z
    .string({ error: 'es obligatorio' })
    .trim()
    .min(1, { error: 'es obligatorio: explica qué cambió en esta versión' })
    .max(MOTIVO_MAXIMO, { error: `no puede pasar de ${MOTIVO_MAXIMO} caracteres` }),
});

const esquemaRestauracion = z.object({
  motivo: z
    .string()
    .trim()
    .max(MOTIVO_MAXIMO, { error: `no puede pasar de ${MOTIVO_MAXIMO} caracteres` })
    .optional(),
});

function leer<T>(esquema: z.ZodType<T>, cuerpo: unknown): T {
  const resultado = esquema.safeParse(cuerpo ?? {});
  if (resultado.success) return resultado.data;
  throw new DatosInvalidosError(
    resultado.error.issues.map((p) => `${p.path.join('.') || 'cuerpo'}: ${p.message}`),
  );
}

/** Código de PostgreSQL para una violación de restricción única. */
const VIOLACION_UNICA = '23505';

function esViolacionUnica(error: unknown): boolean {
  // Drizzle envuelve el error de pg: el código puede estar en el error o en su causa.
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code === VIOLACION_UNICA || e?.cause?.code === VIOLACION_UNICA;
}

/** Lo que un llamador que ya hizo parte del trabajo puede aportar a `agregar`. */
export interface OpcionesVersion {
  /** Texto ya extraído del archivo, para no extraerlo dos veces. */
  texto?: TextoDeVersion;
  /** Se ejecuta dentro de la misma transacción que la versión y su evento (p. ej. otro evento de auditoría). */
  alRegistrar?: (tx: Transaccion, numero: number) => Promise<void>;
}

@Injectable()
export class VersionesService {
  private readonly logger = new Logger(VersionesService.name);

  constructor(
    @Inject(DocumentosRepository) private readonly repositorio: DocumentosRepository,
    @Inject(ALMACEN) private readonly almacen: AlmacenArchivos,
    @Inject(AuditoriaService) private readonly auditoria: AuditoriaService,
  ) {}

  /** Historial completo, la versión más reciente primero. */
  async listar(documentoId: number): Promise<VersionDetalle[]> {
    if (!(await this.repositorio.existeDocumento(documentoId))) {
      throw new NotFoundException(`No existe el documento ${documentoId}`);
    }
    return this.repositorio.listarVersiones(documentoId);
  }

  /**
   * Agrega una versión con contenido nuevo. El motivo es obligatorio. Subir un archivo idéntico a
   * una versión que ya tiene el documento se rechaza con 409 y se dice cuál es.
   * Mismo orden que la carga: objeto primero, luego una transacción con la fila y la auditoría.
   */
  async agregar(
    documentoId: number,
    cuerpo: unknown,
    archivo: ArchivoRecibido | undefined,
    usuario: UsuarioSesion,
    opciones: OpcionesVersion = {},
  ): Promise<VersionDetalle> {
    const { motivo } = leer(esquemaNuevaVersion, cuerpo);
    if (!archivo) throw new BadRequestException('Falta el archivo PDF (campo "archivo")');
    const preparado = prepararArchivo(archivo);
    // Antes de guardar nada: si el documento no existe, no se sube el archivo.
    if (!(await this.repositorio.existeDocumento(documentoId))) {
      throw new NotFoundException(`No existe el documento ${documentoId}`);
    }

    const texto = opciones.texto ?? (await extraerTexto(preparado.datos));

    await this.almacen.guardar(preparado.clave, preparado.datos, 'application/pdf');
    try {
      const numero = await this.repositorio.enTransaccion(async (tx) => {
        // Bloquea el documento: las versiones simultáneas se ponen en fila.
        if (!(await this.repositorio.bloquearDocumento(tx, documentoId))) {
          throw new NotFoundException(`No existe el documento ${documentoId}`);
        }
        const repetida = await this.repositorio.numeroConHuella(tx, documentoId, preparado.sha256);
        if (repetida !== undefined) throw this.contenidoRepetido(repetida);

        const vigente = await this.repositorio.versionVigente(tx, documentoId);
        const nuevo = (vigente?.numero ?? 0) + 1;
        await this.repositorio.insertarVersion(tx, {
          documentoId,
          numero: nuevo,
          archivo: preparado.clave,
          nombreOriginal: preparado.nombreOriginal,
          sha256: preparado.sha256,
          tamano: preparado.datos.length,
          motivo,
          autorId: usuario.id,
          textoEstado: texto.estado,
          textoNormalizado: texto.textoNormalizado,
          firma: texto.firma,
        });
        await this.auditoria.registrar(
          {
            usuarioId: usuario.id,
            accion: ACCION.VERSION,
            documentoId,
            detalle: `versión ${nuevo}; sha256 ${preparado.sha256.slice(0, 12)}`,
          },
          tx,
        );
        await opciones.alRegistrar?.(tx, nuevo);
        return nuevo;
      });
      return await this.detalle(documentoId, numero);
    } catch (error) {
      await compensarObjeto(preparado.clave, this.repositorio, this.almacen, this.logger);
      // Si dos cargas idénticas llegaron a la vez, la restricción única de la base lo atrapa.
      if (esViolacionUnica(error)) throw this.contenidoRepetido(undefined);
      throw error;
    }
  }

  /**
   * Restaura una versión anterior creando una versión NUEVA con su mismo contenido. Nada se edita
   * ni se borra: el historial solo crece. El archivo no se copia, la versión nueva apunta al mismo objeto.
   */
  async restaurar(
    documentoId: number,
    numeroOrigen: number,
    cuerpo: unknown,
    usuario: UsuarioSesion,
  ): Promise<VersionDetalle> {
    const { motivo: motivoDado } = leer(esquemaRestauracion, cuerpo);
    const motivo = motivoDado ? motivoDado : `Restaura la versión ${numeroOrigen}`;

    // Se comprueba antes de la transacción que el archivo de origen siga en el almacén.
    const nuevo = await this.repositorio.enTransaccion(async (tx) => {
      if (!(await this.repositorio.bloquearDocumento(tx, documentoId))) {
        throw new NotFoundException(`No existe el documento ${documentoId}`);
      }
      const origen = await this.repositorio.buscarVersionCompleta(tx, documentoId, numeroOrigen);
      if (!origen) {
        throw new NotFoundException(
          `No existe la versión ${numeroOrigen} del documento ${documentoId}`,
        );
      }
      const vigente = await this.repositorio.versionVigente(tx, documentoId);
      if (vigente && vigente.sha256 === origen.sha256) {
        throw new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          message:
            vigente.numero === numeroOrigen
              ? `La versión ${numeroOrigen} ya es la vigente`
              : `La versión vigente (${vigente.numero}) ya tiene el mismo contenido que la ${numeroOrigen}`,
          versionVigente: vigente.numero,
        });
      }
      if (!(await this.almacen.existe(origen.archivo))) {
        this.logger.error(
          `Falta el objeto ${origen.archivo} del documento ${documentoId}, versión ${numeroOrigen}`,
        );
        throw new NotFoundException('El archivo de esa versión no está disponible');
      }

      const texto = await this.repositorio.buscarTexto(tx, documentoId, numeroOrigen);
      const numero = (vigente?.numero ?? 0) + 1;
      await this.repositorio.insertarVersion(tx, {
        documentoId,
        numero,
        archivo: origen.archivo,
        nombreOriginal: origen.nombreOriginal,
        sha256: origen.sha256,
        tamano: origen.tamano,
        motivo,
        restauradaDe: numeroOrigen,
        autorId: usuario.id,
        // El contenido es el mismo: se copian el texto y la firma de la versión restaurada.
        textoEstado: texto?.textoEstado ?? 'sin_texto',
        textoNormalizado: texto?.textoNormalizado ?? null,
        firma: texto?.firma ?? null,
      });
      await this.auditoria.registrar(
        {
          usuarioId: usuario.id,
          accion: ACCION.RESTAURACION,
          documentoId,
          detalle: `versión ${numeroOrigen} restaurada como versión ${numero}`,
        },
        tx,
      );
      return numero;
    });
    return this.detalle(documentoId, nuevo);
  }

  private async detalle(documentoId: number, numero: number): Promise<VersionDetalle> {
    const version = await this.repositorio.detalleDeVersion(documentoId, numero);
    if (!version) throw new Error(`La versión ${numero} del documento ${documentoId} no quedó guardada`);
    return version;
  }

  private contenidoRepetido(numero: number | undefined): ConflictException {
    return new ConflictException({
      statusCode: 409,
      error: 'Conflict',
      message:
        numero === undefined
          ? 'Este contenido ya está en una versión del documento'
          : `Este contenido ya está en la versión ${numero} del documento`,
      versionExistente: numero ?? null,
    });
  }
}
