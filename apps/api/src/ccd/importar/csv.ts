/**
 * Lector de CSV para la importación del cuadro de clasificación (#19, ADR-010). Funciones puras, sin
 * dependencias: el formato es pequeño y conviene que cada caso raro tenga una prueba y un mensaje en español.
 *
 * Qué acepta:
 *  - texto en UTF-8 con o sin BOM; saltos de línea CRLF, LF o CR;
 *  - separador coma o punto y coma (Excel en español guarda con punto y coma), que se detecta en la cabecera;
 *  - campos entre comillas dobles, con comas, separadores y saltos de línea dentro, y `""` para una comilla;
 *  - líneas vacías (se omiten).
 *
 * Qué rechaza, con el número de línea: comillas sin cerrar, comillas en medio de un campo sin comillas y texto
 * pegado después de cerrar las comillas. No adivina: un archivo que se lee distinto de como lo escribió quien
 * lo preparó es peor que un error claro.
 */

/** Un problema del archivo. `linea` es nula cuando no corresponde a una línea concreta (cabecera, tamaño…). */
export interface ErrorLinea {
  linea: number | null;
  mensaje: string;
}

/** Los campos de una línea del archivo (o del grupo de líneas, si un campo trae saltos entre comillas). */
export interface RegistroCsv {
  /** Línea en la que empieza el registro (la primera es la 1). */
  linea: number;
  campos: string[];
}

export interface ResultadoCsv {
  /** `null` si la cabecera no permite saber cuál es (en ese caso no hay registros y sí un error). */
  separador: ',' | ';' | null;
  registros: RegistroCsv[];
  errores: ErrorLinea[];
  /** Verdadero si unas comillas sin cerrar se tragaron el resto del archivo: los registros ya no sirven. */
  truncado: boolean;
}

export class CodificacionInvalidaError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'CodificacionInvalidaError';
  }
}

/**
 * Convierte los bytes del archivo en texto. Exige UTF-8 (quita el BOM si lo trae) y no intenta adivinar
 * otra codificación: Excel en Windows guarda por defecto en ANSI (Windows-1252), y leerlo como UTF-8 dañaría
 * las tildes sin avisar, así que se rechaza con la instrucción para guardarlo bien.
 */
export function decodificar(bytes: Uint8Array): string {
  const esUtf16 =
    bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff));
  if (esUtf16) {
    throw new CodificacionInvalidaError(
      'El archivo está en UTF-16 (en Excel, «Texto Unicode»). Guárdalo como «CSV UTF-8 (delimitado por comas)».',
    );
  }
  let texto: string;
  try {
    texto = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new CodificacionInvalidaError(
      'El archivo no está en UTF-8 (Excel guarda por defecto en ANSI y se pierden las tildes). ' +
        'Guárdalo como «CSV UTF-8 (delimitado por comas)».',
    );
  }
  if (texto.includes('\u0000')) {
    throw new CodificacionInvalidaError('El archivo parece binario (por ejemplo un .xlsx), no un CSV de texto.');
  }
  return texto;
}

/**
 * El separador es el que más aparece en la primera línea con contenido, fuera de comillas. Con empate
 * (incluido «ninguno») no se adivina: se devuelve `null` y quien llama informa que la cabecera no se entiende.
 */
export function detectarSeparador(texto: string): ',' | ';' | null {
  let comas = 0;
  let puntosYComas = 0;
  let enComillas = false;
  let contenido = false;
  for (const c of texto) {
    if (c === '"') {
      enComillas = !enComillas;
      contenido = true;
    } else if (!enComillas && (c === '\n' || c === '\r')) {
      if (contenido) break;
    } else {
      if (c.trim() !== '') contenido = true;
      if (!enComillas && c === ',') comas++;
      else if (!enComillas && c === ';') puntosYComas++;
    }
  }
  if (comas === puntosYComas) return null;
  return comas > puntosYComas ? ',' : ';';
}

/** Quita el BOM que haya quedado (si el archivo lo traía duplicado) para que no se pegue al primer campo. */
function sinBom(texto: string): string {
  return texto.startsWith('\uFEFF') ? texto.slice(1) : texto;
}

/** Lee todos los registros del texto. Una línea en blanco no produce registro. */
export function analizarCsv(textoCrudo: string): ResultadoCsv {
  const texto = sinBom(textoCrudo);
  const separador = detectarSeparador(texto);
  if (separador === null) {
    const mensaje =
      texto.trim() === ''
        ? 'El archivo está vacío.'
        : 'No reconozco el separador de la cabecera: debe llevar comas o puntos y coma (no una mezcla pareja).';
    return { separador: null, registros: [], errores: [{ linea: 1, mensaje }], truncado: false };
  }

  const registros: RegistroCsv[] = [];
  const errores: ErrorLinea[] = [];

  let campos: string[] = [];
  let campo = '';
  let estado: 'inicio' | 'sinComillas' | 'conComillas' | 'trasComillas' = 'inicio';
  let linea = 1;
  let lineaRegistro = 1;
  let lineaComillas = 1;

  const cerrarRegistro = (): void => {
    // En `inicio` y sin campos previos la línea estaba en blanco: no hay registro.
    if (estado !== 'inicio' || campos.length > 0) {
      campos.push(campo);
      registros.push({ linea: lineaRegistro, campos });
    }
    campos = [];
    campo = '';
    estado = 'inicio';
  };

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    const esSalto = c === '\n' || c === '\r';
    if (esSalto && estado !== 'conComillas') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      cerrarRegistro();
      linea++;
      lineaRegistro = linea;
      continue;
    }
    switch (estado) {
      case 'inicio':
        if (c === '"') {
          estado = 'conComillas';
          lineaComillas = linea;
        } else if (c === separador) {
          campos.push('');
        } else {
          campo = c;
          estado = 'sinComillas';
        }
        break;
      case 'sinComillas':
        if (c === separador) {
          campos.push(campo);
          campo = '';
          estado = 'inicio';
        } else {
          if (c === '"') {
            errores.push({
              linea,
              mensaje:
                'Comillas dentro de un campo que no está entre comillas (si el texto lleva comillas, el campo debe ir entre comillas y cada comilla escrita dos veces).',
            });
          }
          campo += c;
        }
        break;
      case 'conComillas':
        if (c === '"') {
          if (texto[i + 1] === '"') {
            campo += '"';
            i++;
          } else {
            estado = 'trasComillas';
          }
        } else {
          if (c === '\n' || (c === '\r' && texto[i + 1] !== '\n')) linea++;
          campo += c;
        }
        break;
      case 'trasComillas':
        if (c === separador) {
          campos.push(campo);
          campo = '';
          estado = 'inicio';
        } else {
          errores.push({ linea, mensaje: 'Hay texto pegado después de cerrar las comillas de un campo.' });
          // Se descarta lo que sobra hasta el siguiente separador o salto de línea.
          while (i + 1 < texto.length && ![separador, '\n', '\r'].includes(texto[i + 1])) i++;
        }
        break;
    }
  }

  let truncado = false;
  if (estado === 'conComillas') {
    truncado = true;
    errores.push({ linea: lineaComillas, mensaje: 'Comillas sin cerrar: el campo que empieza aquí no termina nunca.' });
  } else {
    cerrarRegistro();
  }

  return { separador, registros, errores, truncado };
}
