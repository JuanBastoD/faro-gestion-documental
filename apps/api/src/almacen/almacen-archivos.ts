/** Token de inyección: @Inject(ALMACEN). */
export const ALMACEN = Symbol('ALMACEN');

export interface ObjetoAlmacenado {
  clave: string;
  modificadoEn: Date;
}

/**
 * Puerto de almacenamiento de archivos (ADR-002). Las reglas de negocio dependen de esta
 * interfaz; hay un adaptador para una carpeta del equipo y otro para un almacén S3
 * compatible (RustFS en local, Cloud Storage en la nube).
 *
 * Las claves las genera el sistema (por ejemplo `documentos/<sha256>.pdf`), nunca el usuario.
 */
export interface AlmacenArchivos {
  /** Guarda el objeto. Si la clave ya existe lo reemplaza (con una clave por huella, es el mismo contenido). */
  guardar(clave: string, datos: Buffer, tipoContenido: string): Promise<void>;
  /** Lanza ObjetoNoEncontradoError si no existe. */
  leer(clave: string): Promise<Buffer>;
  existe(clave: string): Promise<boolean>;
  /** Es idempotente: borrar algo que no existe no es un error. */
  borrar(clave: string): Promise<void>;
  /** Objetos cuya clave empieza por el prefijo. */
  listar(prefijo: string): Promise<ObjetoAlmacenado[]>;
}

export class ObjetoNoEncontradoError extends Error {
  constructor(readonly clave: string) {
    super(`No existe el objeto ${clave}`);
    this.name = 'ObjetoNoEncontradoError';
  }
}

export class ClaveInvalidaError extends Error {
  constructor(clave: string) {
    super(`Clave de objeto inválida: ${JSON.stringify(clave.slice(0, 80))}`);
    this.name = 'ClaveInvalidaError';
  }
}

/**
 * Minúsculas, dígitos y `_ - . /`; sin segmentos vacíos, sin `..` y sin empezar por `/` o `.`.
 * Con esto una clave no puede salirse de la carpeta del almacén ni confundirse con una ruta absoluta.
 */
const FORMATO_CLAVE = /^[a-z0-9][a-z0-9_-]*(?:\.[a-z0-9_-]+)*(?:\/[a-z0-9][a-z0-9_-]*(?:\.[a-z0-9_-]+)*)*$/;

export function validarClave(clave: string): void {
  if (clave.length === 0 || clave.length > 300 || !FORMATO_CLAVE.test(clave)) {
    throw new ClaveInvalidaError(clave);
  }
}

/** Prefijo para listar: como una clave, pero puede terminar en `/` o estar vacío. */
export function validarPrefijo(prefijo: string): void {
  if (prefijo === '') return;
  validarClave(prefijo.endsWith('/') ? prefijo.slice(0, -1) : prefijo);
}
