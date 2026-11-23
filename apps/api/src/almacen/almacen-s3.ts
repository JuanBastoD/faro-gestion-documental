import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  ObjetoNoEncontradoError,
  validarClave,
  validarPrefijo,
  type AlmacenArchivos,
  type ObjetoAlmacenado,
} from './almacen-archivos.js';

export interface OpcionesS3 {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
}

/** Almacén S3 compatible: RustFS en local, Cloud Storage (modo interoperable) o cualquier otro. */
export class AlmacenS3 implements AlmacenArchivos {
  private readonly cliente: S3Client;
  private readonly bucket: string;

  constructor(opciones: OpcionesS3) {
    this.bucket = opciones.bucket;
    this.cliente = new S3Client({
      endpoint: opciones.endpoint,
      region: opciones.region,
      // RustFS, MinIO y Cloud Storage esperan el bucket en la ruta, no en el subdominio.
      forcePathStyle: true,
      credentials: { accessKeyId: opciones.accessKey, secretAccessKey: opciones.secretKey },
      // Las sumas de verificación automáticas de las versiones recientes del SDK no las
      // aceptan todos los almacenes compatibles; solo se calculan cuando el servicio las exige.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  async guardar(clave: string, datos: Buffer, tipoContenido: string): Promise<void> {
    validarClave(clave);
    await this.cliente.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: clave,
        Body: datos,
        ContentLength: datos.length,
        ContentType: tipoContenido,
      }),
    );
  }

  async leer(clave: string): Promise<Buffer> {
    validarClave(clave);
    try {
      const respuesta = await this.cliente.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: clave }),
      );
      return Buffer.from((await respuesta.Body?.transformToByteArray()) ?? []);
    } catch (error) {
      if (noExiste(error)) throw new ObjetoNoEncontradoError(clave);
      throw error;
    }
  }

  async existe(clave: string): Promise<boolean> {
    validarClave(clave);
    try {
      await this.cliente.send(new HeadObjectCommand({ Bucket: this.bucket, Key: clave }));
      return true;
    } catch (error) {
      if (noExiste(error)) return false;
      throw error;
    }
  }

  async borrar(clave: string): Promise<void> {
    validarClave(clave);
    // S3 responde 204 también si el objeto no existe.
    await this.cliente.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: clave }));
  }

  async listar(prefijo: string): Promise<ObjetoAlmacenado[]> {
    validarPrefijo(prefijo);
    const encontrados: ObjetoAlmacenado[] = [];
    let continuacion: string | undefined;
    do {
      const pagina = await this.cliente.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefijo,
          ContinuationToken: continuacion,
        }),
      );
      for (const objeto of pagina.Contents ?? []) {
        if (objeto.Key && objeto.LastModified) {
          encontrados.push({ clave: objeto.Key, modificadoEn: objeto.LastModified });
        }
      }
      continuacion = pagina.IsTruncated ? pagina.NextContinuationToken : undefined;
    } while (continuacion);
    return encontrados.sort((a, b) => a.clave.localeCompare(b.clave));
  }

  /** Libera las conexiones abiertas. */
  cerrar(): void {
    this.cliente.destroy();
  }
}

function noExiste(error: unknown): boolean {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NoSuchKey' || e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404;
}
