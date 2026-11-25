import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { BaseDatos } from '../../base-datos/base-datos.module.js';
import type { ErrorLinea } from './csv.js';
import { LIMITES_CUADRO, validarCuadroDesdeBytes } from './cuadro.js';
import { formatearErrores, formatearPlan } from './informe.js';
import { importarCuadro, type SolicitudImportacion } from './importar.js';
import { hayCambios } from './plan.js';

/**
 * Lógica del comando `ccd:importar` (#19, ADR-010), separada del arranque (`importar-cli.ts`) para poder
 * probarla sin lanzar un proceso: leer los argumentos y el archivo no necesita la base de datos, y escribir
 * en ella recibe la conexión ya hecha.
 */

/** Códigos de salida del comando. */
export const SALIDA = {
  /** Se mostró el plan o se aplicó, o ya no había nada que cambiar. */
  OK: 0,
  /** El archivo no es válido o contradice lo que hay en la base (por ejemplo, mover una serie con documentos). No se escribió nada. */
  RECHAZADO: 1,
  /** Uso incorrecto: falta el archivo, una opción no existe o el archivo no se puede leer. */
  USO: 2,
} as const;

export const AYUDA = `Uso: ccd:importar <archivo.csv> [--aplicar] [--eliminar-ausentes]

Importa el cuadro de clasificación documental (series y subseries) desde un CSV.

  <archivo.csv>        CSV en UTF-8 con las columnas codigo, nombre y codigo_padre
                       (padre vacío = serie; con padre = subserie de esa serie).
  --aplicar            Escribe los cambios, todos en una sola transacción. Sin esta opción
                       solo muestra lo que haría y no cambia nada.
  --eliminar-ausentes  Elimina las series y subseries que están en la base y no en el archivo,
                       salvo las que tengan documentos (esas nunca se eliminan). Sin esta opción
                       solo se informan.

Salida: 0 correcto; 1 el archivo no es válido o choca con documentos existentes (no se escribió
nada); 2 uso incorrecto.`;

const OPCIONES = ['aplicar', 'eliminar-ausentes', 'ayuda'];

/** Un archivo que pasó la validación y está listo para mostrarse o aplicarse. */
export interface ImportacionLista {
  solicitud: SolicitudImportacion;
  avisos: string[];
  archivo: string;
}

export type Preparacion =
  | { tipo: 'ayuda' }
  | { tipo: 'uso'; mensaje: string }
  | { tipo: 'invalido'; archivo: string; errores: ErrorLinea[]; avisos: string[] }
  | ({ tipo: 'listo' } & ImportacionLista);

/**
 * Lee los argumentos, el archivo y lo valida. No usa la base de datos: un archivo mal armado se informa
 * aunque la conexión no esté lista. `carpetaBase` resuelve las rutas relativas (con `npm run` es la carpeta
 * desde la que se lanzó npm, `INIT_CWD`; npm ejecuta el script dentro de `apps/api`).
 */
export function prepararImportacion(argv: string[], carpetaBase: string): Preparacion {
  // Sin `strict` para poder decir en español qué opción no se conoce (el mensaje de Node es en inglés).
  const { values: valores, positionals: posicionales } = parseArgs({
    args: argv,
    options: {
      aplicar: { type: 'boolean' },
      'eliminar-ausentes': { type: 'boolean' },
      ayuda: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
    strict: false,
  });
  if (valores.ayuda === true) return { tipo: 'ayuda' };
  const desconocidas = Object.keys(valores).filter((nombre) => !OPCIONES.includes(nombre));
  if (desconocidas.length > 0) {
    return { tipo: 'uso', mensaje: `Opción desconocida: ${desconocidas.map((n) => (n.length === 1 ? `-${n}` : `--${n}`)).join(', ')}.` };
  }
  if (posicionales.length !== 1) {
    return { tipo: 'uso', mensaje: posicionales.length === 0 ? 'Falta el archivo CSV.' : 'Indica un solo archivo CSV.' };
  }

  const ruta = resolve(carpetaBase, posicionales[0]);
  const archivo = basename(ruta);
  let bytes: Buffer;
  try {
    if (statSync(ruta).size > LIMITES_CUADRO.bytesMaximos) {
      return {
        tipo: 'invalido',
        archivo,
        avisos: [],
        errores: [
          {
            linea: null,
            mensaje: `El archivo pesa más de ${LIMITES_CUADRO.bytesMaximos} bytes: no parece un cuadro de clasificación.`,
          },
        ],
      };
    }
    bytes = readFileSync(ruta);
  } catch (error) {
    const codigo = (error as NodeJS.ErrnoException).code;
    return {
      tipo: 'uso',
      mensaje: codigo === 'ENOENT' ? `No encuentro el archivo ${ruta}.` : `No pude leer ${ruta}: ${(error as Error).message}`,
    };
  }

  const lectura = validarCuadroDesdeBytes(bytes);
  if (lectura.errores.length > 0) {
    return { tipo: 'invalido', archivo, errores: lectura.errores, avisos: lectura.avisos };
  }
  return {
    tipo: 'listo',
    archivo,
    avisos: lectura.avisos,
    solicitud: {
      filas: lectura.filas,
      aplicar: valores.aplicar === true,
      eliminarAusentes: valores['eliminar-ausentes'] === true,
      origen: { archivo, sha256: createHash('sha256').update(bytes).digest('hex') },
    },
  };
}

export interface Salidas {
  info(texto: string): void;
  error(texto: string): void;
}

/** Imprime lo que pasó con un archivo ya válido, escribiendo en la base solo si se pidió `--aplicar`. */
export async function ejecutarImportacion(db: BaseDatos, listo: ImportacionLista, salidas: Salidas): Promise<number> {
  const { solicitud, archivo } = listo;
  const { plan, aplicado } = await importarCuadro(db, solicitud);
  const contexto = { filas: solicitud.filas, aplicado, eliminarAusentes: solicitud.eliminarAusentes };

  if (plan.conflictos.length > 0) {
    salidas.error(
      formatearErrores(
        `No se importó nada: ${archivo} contradice lo que ya hay en la base de datos (${plan.conflictos.length}).`,
        plan.conflictos,
      ),
    );
    return SALIDA.RECHAZADO;
  }

  const hay = hayCambios(plan);
  if (!hay) {
    salidas.info(`${formatearPlan(plan, contexto)}\n\nLa base ya coincide con ${archivo}: no hay nada que cambiar.`);
  } else if (aplicado) {
    salidas.info(
      `Importación aplicada desde ${archivo}.\n${formatearPlan(plan, contexto)}\n\n` +
        'Quedó registrado el evento de auditoría ccd_importado.',
    );
  } else {
    salidas.info(
      `SIMULACIÓN con ${archivo}: no se escribió nada.\n${formatearPlan(plan, contexto)}\n\n` +
        'Para aplicar estos cambios, repite el comando con --aplicar.',
    );
  }
  return SALIDA.OK;
}

/** Texto para un archivo que no pasó la validación. */
export function textoDeArchivoInvalido(archivo: string, errores: ErrorLinea[]): string {
  const problemas = errores.length === 1 ? '1 problema' : `${errores.length} problemas`;
  return formatearErrores(`${archivo} no es válido (${problemas}). No se escribió nada.`, errores);
}
