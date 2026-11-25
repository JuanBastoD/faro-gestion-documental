import { analizarCsv, CodificacionInvalidaError, decodificar, type ErrorLinea } from './csv.js';

/**
 * Validación del cuadro de clasificación que llega en el CSV (#19, ADR-010). Todo se valida antes de tocar la
 * base y se informan todos los problemas juntos, cada uno con su línea, para que quien prepara el archivo los
 * corrija de una vez.
 *
 * El archivo es el cuadro **completo y autocontenido**: cada padre que se nombra tiene su propia fila. Así la
 * validación no depende de lo que haya en la base y el mismo archivo da el mismo resultado en cualquier entorno.
 */

/** Una serie (sin padre) o subserie (con padre) del archivo, ya limpia. */
export interface FilaCuadro {
  /** Línea del archivo donde está, para los mensajes. */
  linea: number;
  codigo: string;
  nombre: string;
  /** `null` en una serie; en una subserie, el código de su serie. */
  codigoPadre: string | null;
}

export interface ResultadoCuadro {
  /** Solo es fiable cuando `errores` está vacío. */
  filas: FilaCuadro[];
  errores: ErrorLinea[];
  /** Observaciones que no impiden importar (por ejemplo, columnas que se ignoran). */
  avisos: string[];
}

/** Límites del formato [PROPUESTA]: no vienen del esquema (`text`), los fija la importación. */
export const LIMITES_CUADRO = {
  codigoMaximo: 32,
  nombreMaximo: 200,
  filasMaximas: 2000,
  /** Un cuadro real son decenas de filas: más de 1 MiB casi seguro es el archivo equivocado. */
  bytesMaximos: 1024 * 1024,
} as const;

/** Letras, números y los separadores `.`, `-` o `_` entre ellos (no al principio, al final ni repetidos). */
const FORMATO_CODIGO = /^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/;
/** `Cc` es la categoría Unicode de los caracteres de control (no imprimibles). */
const CARACTERES_DE_CONTROL = /\p{Cc}/u;

const COLUMNAS = ['codigo', 'nombre', 'codigo_padre'] as const;

/** `Código Padre`, `codigo-padre` y `CODIGO_PADRE` son la misma columna. */
function normalizarCabecera(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

/** Quita los espacios de los lados, junta los repetidos y deja las tildes compuestas (NFC). */
function limpiar(texto: string): string {
  return texto.normalize('NFC').replace(/\s+/g, ' ').trim();
}

function problemaDeCodigo(codigo: string): string | null {
  if (codigo.length > LIMITES_CUADRO.codigoMaximo) {
    return `tiene ${codigo.length} caracteres y el máximo es ${LIMITES_CUADRO.codigoMaximo}`;
  }
  if (!FORMATO_CODIGO.test(codigo)) {
    return 'solo admite letras, números y los separadores . - _ entre ellos (sin espacios; por ejemplo 100 o 100.1)';
  }
  return null;
}

/**
 * Valida el texto de un CSV y devuelve las filas del cuadro. Cabecera esperada: `codigo`, `nombre` y
 * `codigo_padre` (en cualquier orden; otras columnas se ignoran con un aviso).
 */
export function validarCuadro(texto: string): ResultadoCuadro {
  const csv = analizarCsv(texto);
  const errores: ErrorLinea[] = [...csv.errores];
  const avisos: string[] = [];
  const devolver = (filas: FilaCuadro[]): ResultadoCuadro => ({
    filas,
    errores: ordenarErrores(errores),
    avisos,
  });

  // Sin separador o con comillas sin cerrar, lo que sigue no tendría sentido: se informa solo lo ya encontrado.
  if (csv.separador === null || csv.truncado) return devolver([]);

  const [cabecera, ...registros] = csv.registros;
  if (!cabecera) {
    errores.push({ linea: 1, mensaje: 'El archivo está vacío.' });
    return devolver([]);
  }

  // --- Cabecera ---------------------------------------------------------------------------------------
  const nombres = cabecera.campos.map(normalizarCabecera);
  const indice = new Map<string, number>();
  nombres.forEach((nombre, i) => {
    if (nombre === '') return;
    if (indice.has(nombre)) {
      errores.push({ linea: cabecera.linea, mensaje: `La columna «${nombre}» está repetida en la cabecera.` });
    } else {
      indice.set(nombre, i);
    }
  });
  const faltan = COLUMNAS.filter((c) => !indice.has(c));
  if (faltan.length > 0) {
    errores.push({
      linea: cabecera.linea,
      mensaje: `Faltan columnas en la cabecera: ${faltan.join(', ')}. La cabecera debe ser: ${COLUMNAS.join(', ')}.`,
    });
    return devolver([]);
  }
  const extras = nombres.filter((n) => n !== '' && !(COLUMNAS as readonly string[]).includes(n));
  if (extras.length > 0) avisos.push(`Se ignoran las columnas que no son del cuadro: ${extras.join(', ')}.`);

  const colCodigo = indice.get('codigo') as number;
  const colNombre = indice.get('nombre') as number;
  const colPadre = indice.get('codigo_padre') as number;

  // --- Filas ------------------------------------------------------------------------------------------
  const filas: FilaCuadro[] = [];
  const primeraLineaDe = new Map<string, FilaCuadro>();
  const primeraSinMayusculas = new Map<string, FilaCuadro>();
  let conDatos = 0;

  for (const registro of registros) {
    const { linea, campos } = registro;
    if (campos.every((c) => c.trim() === '')) continue;

    conDatos++;
    if (conDatos > LIMITES_CUADRO.filasMaximas) {
      if (conDatos === LIMITES_CUADRO.filasMaximas + 1) {
        errores.push({
          linea,
          mensaje: `El archivo tiene más de ${LIMITES_CUADRO.filasMaximas} filas: no parece un cuadro de clasificación.`,
        });
      }
      continue;
    }

    if (campos.length > nombres.length && campos.slice(nombres.length).some((c) => c.trim() !== '')) {
      errores.push({
        linea,
        mensaje: `La fila tiene ${campos.length} campos y la cabecera ${nombres.length} (¿una coma o punto y coma sin comillas dentro de un nombre?).`,
      });
      continue;
    }

    const codigo = limpiar(campos[colCodigo] ?? '');
    const nombre = limpiar(campos[colNombre] ?? '');
    const padre = limpiar(campos[colPadre] ?? '');
    let valida = true;

    if (codigo === '') {
      errores.push({ linea, mensaje: 'El código está vacío.' });
      valida = false;
    } else {
      const problema = problemaDeCodigo(codigo);
      if (problema) {
        errores.push({ linea, mensaje: `El código «${codigo}» ${problema}.` });
        valida = false;
      }
    }
    if (nombre === '') {
      errores.push({ linea, mensaje: `El nombre está vacío${codigo ? ` (código ${codigo})` : ''}.` });
      valida = false;
    } else if (nombre.length > LIMITES_CUADRO.nombreMaximo) {
      errores.push({
        linea,
        mensaje: `El nombre de ${codigo || 'la fila'} tiene ${nombre.length} caracteres y el máximo es ${LIMITES_CUADRO.nombreMaximo}.`,
      });
      valida = false;
    } else if (CARACTERES_DE_CONTROL.test(nombre)) {
      errores.push({ linea, mensaje: `El nombre de ${codigo || 'la fila'} tiene caracteres de control (no imprimibles).` });
      valida = false;
    }
    if (padre !== '') {
      const problema = problemaDeCodigo(padre);
      if (problema) {
        errores.push({ linea, mensaje: `El código del padre «${padre}» ${problema}.` });
        valida = false;
      } else if (padre === codigo) {
        errores.push({ linea, mensaje: `${codigo} no puede ser su propio padre.` });
        valida = false;
      }
    }

    const fila: FilaCuadro = { linea, codigo, nombre, codigoPadre: padre === '' ? null : padre };
    if (codigo !== '' && problemaDeCodigo(codigo) === null) {
      const repetida = primeraLineaDe.get(codigo);
      const parecida = primeraSinMayusculas.get(codigo.toLowerCase());
      if (repetida) {
        errores.push({ linea, mensaje: `El código ${codigo} está repetido (ya aparece en la línea ${repetida.linea}).` });
        valida = false;
      } else if (parecida) {
        errores.push({
          linea,
          mensaje: `El código ${codigo} solo se diferencia en mayúsculas de ${parecida.codigo} (línea ${parecida.linea}): sería un código distinto y casi seguro es un error.`,
        });
        valida = false;
      } else {
        primeraLineaDe.set(codigo, fila);
        primeraSinMayusculas.set(codigo.toLowerCase(), fila);
      }
    }
    if (valida) filas.push(fila);
  }

  // --- Relaciones entre filas (todo padre está en el archivo y el cuadro tiene dos niveles) ------------
  for (const fila of filas) {
    if (fila.codigoPadre === null) continue;
    const padre = primeraLineaDe.get(fila.codigoPadre);
    if (!padre) {
      const parecido = primeraSinMayusculas.get(fila.codigoPadre.toLowerCase());
      errores.push({
        linea: fila.linea,
        mensaje:
          `El padre «${fila.codigoPadre}» de ${fila.codigo} no está en el archivo: cada serie debe tener su propia fila` +
          (parecido ? ` (¿quiso decir ${parecido.codigo}?)` : '') +
          '.',
      });
    } else if (padre.codigoPadre === fila.codigo) {
      errores.push({
        linea: fila.linea,
        mensaje: `Ciclo: ${fila.codigo} y ${padre.codigo} se declaran padre una de la otra.`,
      });
    } else if (padre.codigoPadre !== null) {
      errores.push({
        linea: fila.linea,
        mensaje: `El padre ${padre.codigo} de ${fila.codigo} es una subserie (cuelga de ${padre.codigoPadre}, línea ${padre.linea}): el cuadro tiene dos niveles, serie y subserie.`,
      });
    }
  }

  if (errores.length === 0 && filas.length === 0) {
    errores.push({ linea: null, mensaje: 'El archivo no tiene filas de datos debajo de la cabecera.' });
  }
  return devolver(filas);
}

/** Por línea; los que no tienen línea (generales) primero. */
function ordenarErrores(errores: ErrorLinea[]): ErrorLinea[] {
  return errores
    .map((error, orden) => ({ error, orden }))
    .sort((a, b) => (a.error.linea ?? 0) - (b.error.linea ?? 0) || a.orden - b.orden)
    .map(({ error }) => error);
}

/** Lo mismo que `validarCuadro` pero desde los bytes del archivo (decodifica y comprueba el tamaño). */
export function validarCuadroDesdeBytes(bytes: Uint8Array): ResultadoCuadro {
  if (bytes.length > LIMITES_CUADRO.bytesMaximos) {
    return {
      filas: [],
      errores: [
        {
          linea: null,
          mensaje: `El archivo pesa ${bytes.length} bytes y el máximo es ${LIMITES_CUADRO.bytesMaximos}: no parece un cuadro de clasificación.`,
        },
      ],
      avisos: [],
    };
  }
  try {
    return validarCuadro(decodificar(bytes));
  } catch (error) {
    if (error instanceof CodificacionInvalidaError) {
      return { filas: [], errores: [{ linea: null, mensaje: error.message }], avisos: [] };
    }
    throw error;
  }
}
