/**
 * Cliente HTTP de la API de Faro: un solo lugar que habla con `fetch`.
 *
 * - Siempre al mismo origen (`credentials: 'same-origin'`): en producción la API sirve la interfaz y en
 *   desarrollo Vite hace de proxy (ADR-012). La sesión viaja en la cookie `faro_sesion` (ADR-003); la
 *   interfaz nunca la ve (es `HttpOnly`).
 * - Los errores de la API no tienen un solo formato (ADR-012, sección 2.2). Los que genera Nest traen
 *   `{ statusCode, message, error }`; los de negocio añaden `codigo` (`duplicado_exacto`,
 *   `demasiados_intentos`, `origen_no_permitido`, `ultimo_administrador`...); los de validación traen
 *   además `problemas: string[]` y a veces no traen `statusCode`. Aquí todos terminan en `ErrorApi`,
 *   y el estado HTTP es lo único en lo que se confía para decidir.
 */

export type Metodo = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/** Valores que pueden ir en la cadena de consulta. `undefined`, `null` y el texto vacío no se envían. */
export type ParametrosDeConsulta = Record<string, string | number | boolean | null | undefined>;

export interface OpcionesDePeticion {
  metodo?: Metodo;
  /** Se envía como JSON. */
  cuerpo?: unknown;
  /** Se envía como multipart (cargas de PDF). No se define `Content-Type`: el navegador pone el límite. */
  formulario?: FormData;
  consulta?: ParametrosDeConsulta;
  senal?: AbortSignal;
  /**
   * Un 401 normalmente significa «la sesión terminó» y avisa al manejador registrado con
   * `alExpirarLaSesion`. En el ingreso y en la consulta de quién soy es una respuesta esperada.
   */
  ignorar401?: boolean;
}

/** Un error de la API o de la red, ya normalizado. */
export class ErrorApi extends Error {
  /** Estado HTTP. 0 si no hubo respuesta (sin red, servidor caído, petición abortada por la red). */
  readonly estado: number;
  /** `codigo` de negocio de la API (`demasiados_intentos`, `duplicado_exacto`...), si lo trae. */
  readonly codigo: string | undefined;
  /** Lista de problemas de validación (`problemas`), si la trae. */
  readonly problemas: readonly string[];
  /** Segundos de espera de `Retry-After` (429), si lo trae. */
  readonly esperaSeg: number | undefined;
  /** Cuerpo de la respuesta ya leído (JSON o texto), para quien necesite datos extra (candidatos de duplicado...). */
  readonly cuerpo: unknown;

  constructor(datos: {
    estado: number;
    mensaje: string;
    codigo?: string;
    problemas?: readonly string[];
    esperaSeg?: number;
    cuerpo?: unknown;
  }) {
    super(datos.mensaje);
    this.name = 'ErrorApi';
    this.estado = datos.estado;
    this.codigo = datos.codigo;
    this.problemas = datos.problemas ?? [];
    this.esperaSeg = datos.esperaSeg;
    this.cuerpo = datos.cuerpo;
  }
}

let manejadorDeSesionExpirada: (() => void) | undefined;

/** Registra qué hacer cuando la API responde 401 a una petición que exigía sesión. Devuelve cómo quitarlo. */
export function alExpirarLaSesion(manejador: () => void): () => void {
  manejadorDeSesionExpirada = manejador;
  return () => {
    if (manejadorDeSesionExpirada === manejador) manejadorDeSesionExpirada = undefined;
  };
}

const MENSAJE_POR_ESTADO: Record<number, string> = {
  0: 'No se pudo conectar con el servidor. Revisa tu conexión e intenta de nuevo.',
  400: 'Los datos enviados no son válidos.',
  401: 'Tu sesión terminó o no has ingresado.',
  403: 'No tienes permiso para esta acción.',
  404: 'No se encontró lo que buscas.',
  409: 'La acción choca con el estado actual de los datos.',
  413: 'El archivo es demasiado grande.',
  415: 'El tipo de archivo no es válido.',
  422: 'Los datos enviados no se pueden procesar.',
  429: 'Demasiados intentos. Espera un momento e intenta de nuevo.',
};

function mensajePorDefecto(estado: number): string {
  if (MENSAJE_POR_ESTADO[estado]) return MENSAJE_POR_ESTADO[estado];
  if (estado >= 500) return 'El servidor tuvo un problema. Intenta de nuevo en unos minutos.';
  return `La petición falló (código ${estado}).`;
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

/** `Retry-After` puede ser un número de segundos o una fecha HTTP. */
export function leerEspera(cabecera: string | null, ahora: number = Date.now()): number | undefined {
  if (!cabecera) return undefined;
  const texto = cabecera.trim();
  if (/^\d+$/.test(texto)) return Number(texto);
  const fecha = Date.parse(texto);
  if (Number.isNaN(fecha)) return undefined;
  return Math.max(0, Math.ceil((fecha - ahora) / 1000));
}

function textoDelMensaje(mensaje: unknown): string | undefined {
  if (typeof mensaje === 'string' && mensaje.trim() !== '') return mensaje;
  if (Array.isArray(mensaje)) {
    const textos = mensaje.filter((m): m is string => typeof m === 'string' && m.trim() !== '');
    if (textos.length > 0) return textos.join('; ');
  }
  return undefined;
}

/** Convierte una respuesta con estado de error en un `ErrorApi`, sea cual sea el formato del cuerpo. */
export async function leerError(respuesta: Response): Promise<ErrorApi> {
  const texto = await respuesta.text().catch(() => '');
  let cuerpo: unknown = texto === '' ? undefined : texto;
  try {
    if (texto !== '') cuerpo = JSON.parse(texto);
  } catch {
    // No era JSON (una página de error de un proxy, por ejemplo): se queda el texto.
  }
  const objeto = esObjeto(cuerpo) ? cuerpo : undefined;
  const problemas = Array.isArray(objeto?.problemas)
    ? objeto.problemas.filter((p): p is string => typeof p === 'string')
    : [];
  return new ErrorApi({
    estado: respuesta.status,
    mensaje: textoDelMensaje(objeto?.message) ?? mensajePorDefecto(respuesta.status),
    codigo: typeof objeto?.codigo === 'string' ? objeto.codigo : undefined,
    problemas,
    esperaSeg: leerEspera(respuesta.headers.get('Retry-After')),
    cuerpo,
  });
}

function armarRuta(ruta: string, consulta: ParametrosDeConsulta | undefined): string {
  if (!consulta) return ruta;
  const parametros = new URLSearchParams();
  for (const [clave, valor] of Object.entries(consulta)) {
    if (valor === undefined || valor === null || valor === '') continue;
    parametros.set(clave, String(valor));
  }
  const texto = parametros.toString();
  return texto === '' ? ruta : `${ruta}?${texto}`;
}

/**
 * Hace una petición a la API y devuelve el cuerpo ya convertido. Lanza `ErrorApi` si el estado no es 2xx
 * o si no hubo respuesta. Una respuesta sin cuerpo (204) devuelve `undefined`.
 */
export async function pedir<T>(ruta: string, opciones: OpcionesDePeticion = {}): Promise<T> {
  const { metodo = 'GET', cuerpo, formulario, consulta, senal, ignorar401 = false } = opciones;
  const cabeceras: Record<string, string> = { Accept: 'application/json' };
  let datos: BodyInit | undefined;
  if (formulario) {
    datos = formulario;
  } else if (cuerpo !== undefined) {
    cabeceras['Content-Type'] = 'application/json';
    datos = JSON.stringify(cuerpo);
  }

  let respuesta: Response;
  try {
    respuesta = await fetch(armarRuta(ruta, consulta), {
      method: metodo,
      headers: cabeceras,
      body: datos,
      credentials: 'same-origin',
      signal: senal,
    });
  } catch (error) {
    // Una petición cancelada a propósito no es un fallo: quien la canceló ya no espera el resultado.
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ErrorApi({ estado: 0, mensaje: mensajePorDefecto(0) });
  }

  if (!respuesta.ok) {
    const error = await leerError(respuesta);
    if (error.estado === 401 && !ignorar401) manejadorDeSesionExpirada?.();
    throw error;
  }

  const texto = await respuesta.text();
  if (texto === '') return undefined as T;
  try {
    return JSON.parse(texto) as T;
  } catch {
    throw new ErrorApi({
      estado: respuesta.status,
      mensaje: 'La respuesta del servidor no tiene el formato esperado.',
    });
  }
}
