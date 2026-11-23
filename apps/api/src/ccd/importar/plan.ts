import type { FilaCuadro } from './cuadro.js';
import type { ErrorLinea } from './csv.js';

/**
 * Qué haría la importación del cuadro (#19, ADR-010): compara el archivo ya validado con el cuadro que hay
 * en la base y decide, sin escribir nada, qué se crea, qué se renombra, qué se mueve y qué se elimina.
 * Es una función pura: la misma comparación sirve para mostrar («sin --aplicar») y para aplicar.
 *
 * Reglas (todas dicen «código» porque es lo que identifica a una serie entre el archivo y la base):
 *  - Un código del archivo que no está en la base se crea.
 *  - Uno que ya está solo cambia de nombre; el nombre no es su identidad, así que cambiarlo es seguro aunque
 *    tenga documentos.
 *  - Una subserie sin documentos puede pasar a otra serie; **con documentos no se mueve**: es un conflicto y
 *    la importación entera se niega.
 *  - Un código no cambia de nivel (de serie a subserie o al revés): es un conflicto. El archivo debe usar
 *    otro código.
 *  - Lo que está en la base y no en el archivo se conserva y se informa. Solo con `eliminarAusentes` se
 *    elimina, y aun así **nunca** lo que tenga documentos (ni una serie con una subserie con documentos).
 */

export type NivelSerie = 'serie' | 'subserie';

/** Una fila de `series_ccd` tal como está hoy, con el padre ya traducido a su código. */
export interface SerieActual {
  id: number;
  codigo: string;
  nombre: string;
  padreCodigo: string | null;
  /** Documentos clasificados directamente en esta fila (solo una subserie puede tener). */
  documentos: number;
}

export interface OpcionesPlan {
  eliminarAusentes: boolean;
}

export interface Renombre {
  codigo: string;
  nombreActual: string;
  nombreNuevo: string;
}

export interface Movimiento {
  codigo: string;
  padreActual: string;
  padreNuevo: string;
}

/** Una fila de la base que el archivo no menciona. */
export interface Ausente {
  codigo: string;
  nombre: string;
  nivel: NivelSerie;
  /** Documentos que cuelgan de ella; en una serie, la suma de los de sus subseries. */
  documentos: number;
}

export interface Plan {
  /** Series primero y subseries después, cada grupo en el orden del archivo. */
  crear: FilaCuadro[];
  renombrar: Renombre[];
  mover: Movimiento[];
  /** Subseries primero y series después. Solo con `eliminarAusentes`, y nunca con documentos. */
  eliminar: Ausente[];
  /** Ausentes del archivo que se quedan: todos sin `eliminarAusentes`; con él, los que tienen documentos. */
  conservadas: Ausente[];
  /** Filas del archivo que ya están en la base tal cual. */
  sinCambios: number;
  /** Lo que contradice a la base. Con alguno, no se escribe nada. */
  conflictos: ErrorLinea[];
}

export function hayCambios(plan: Plan): boolean {
  return plan.crear.length + plan.renombrar.length + plan.mover.length + plan.eliminar.length > 0;
}

const nivelDe = (padre: string | null): NivelSerie => (padre === null ? 'serie' : 'subserie');
const porNivel = (a: { codigoPadre: string | null }, b: { codigoPadre: string | null }) =>
  Number(a.codigoPadre !== null) - Number(b.codigoPadre !== null);

export function planificar(filas: FilaCuadro[], actuales: SerieActual[], opciones: OpcionesPlan): Plan {
  const enBase = new Map(actuales.map((s) => [s.codigo, s]));
  const enArchivo = new Set(filas.map((f) => f.codigo));

  const crear: FilaCuadro[] = [];
  const renombrar: Renombre[] = [];
  const mover: Movimiento[] = [];
  const conflictos: ErrorLinea[] = [];
  let sinCambios = 0;

  for (const fila of filas) {
    const actual = enBase.get(fila.codigo);
    if (!actual) {
      crear.push(fila);
      continue;
    }
    let cambia = false;
    if (nivelDe(actual.padreCodigo) !== nivelDe(fila.codigoPadre)) {
      conflictos.push({
        linea: fila.linea,
        mensaje:
          `${fila.codigo} es una ${nivelDe(actual.padreCodigo)} en la base y el archivo la declara ${nivelDe(fila.codigoPadre)}: ` +
          'un código existente no cambia de nivel al importar (usa otro código para la nueva).',
      });
      continue;
    }
    if (actual.padreCodigo !== fila.codigoPadre) {
      if (actual.documentos > 0) {
        conflictos.push({
          linea: fila.linea,
          mensaje:
            `${fila.codigo} tiene ${actual.documentos} documento${actual.documentos === 1 ? '' : 's'} y el archivo la mueve ` +
            `de la serie ${actual.padreCodigo} a la ${fila.codigoPadre}: una subserie con documentos no se mueve al importar.`,
        });
        continue;
      }
      mover.push({ codigo: fila.codigo, padreActual: actual.padreCodigo as string, padreNuevo: fila.codigoPadre as string });
      cambia = true;
    }
    if (actual.nombre !== fila.nombre) {
      renombrar.push({ codigo: fila.codigo, nombreActual: actual.nombre, nombreNuevo: fila.nombre });
      cambia = true;
    }
    if (!cambia) sinCambios++;
  }

  // Ausentes: lo que la base tiene y el archivo no menciona.
  const documentosPorSerie = new Map<string, number>();
  for (const s of actuales) {
    if (s.padreCodigo !== null) {
      documentosPorSerie.set(s.padreCodigo, (documentosPorSerie.get(s.padreCodigo) ?? 0) + s.documentos);
    }
  }
  const ausentes: Ausente[] = actuales
    .filter((s) => !enArchivo.has(s.codigo))
    .map((s) => ({
      codigo: s.codigo,
      nombre: s.nombre,
      nivel: nivelDe(s.padreCodigo),
      documentos: s.padreCodigo === null ? (documentosPorSerie.get(s.codigo) ?? 0) : s.documentos,
    }));

  const eliminar = opciones.eliminarAusentes ? ausentes.filter((a) => a.documentos === 0) : [];
  const conservadas = ausentes.filter((a) => !eliminar.includes(a));

  return {
    crear: [...crear].sort(porNivel),
    renombrar,
    mover,
    eliminar: [...eliminar].sort((a, b) => Number(a.nivel === 'serie') - Number(b.nivel === 'serie')),
    conservadas,
    sinCambios,
    conflictos,
  };
}
