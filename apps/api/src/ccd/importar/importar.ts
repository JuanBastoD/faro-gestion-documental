import { asc, eq, inArray, sql } from 'drizzle-orm';
import { ACCION } from '../../auditoria/acciones.js';
import type { BaseDatos } from '../../base-datos/base-datos.module.js';
import { auditoria, seriesCcd } from '../../base-datos/esquema.js';
import type { FilaCuadro } from './cuadro.js';
import { hayCambios, planificar, type Ausente, type Plan, type SerieActual } from './plan.js';

/**
 * Importación del cuadro de clasificación a la base (#19, ADR-010). Sin `aplicar` solo calcula el plan;
 * con `aplicar` lo escribe todo en **una** transacción: o queda el cuadro completo o no cambia nada.
 */

export interface SolicitudImportacion {
  /** Filas ya validadas por `validarCuadro`. */
  filas: FilaCuadro[];
  aplicar: boolean;
  eliminarAusentes: boolean;
  /** De dónde salió, para la auditoría (nombre del archivo sin carpetas y huella SHA-256 de su contenido). */
  origen: { archivo: string; sha256: string };
}

export interface ResultadoImportacion {
  plan: Plan;
  /** Verdadero solo si se escribió en la base: hubo `aplicar`, ningún conflicto y algo que cambiar. */
  aplicado: boolean;
}

type Lector = Pick<BaseDatos, 'select'>;

/** El cuadro de hoy, ordenado por código, con cuántos documentos cuelgan de cada fila. */
export async function leerCuadroActual(lector: Lector): Promise<SerieActual[]> {
  const filas = await lector
    .select({
      id: seriesCcd.id,
      codigo: seriesCcd.codigo,
      nombre: seriesCcd.nombre,
      padreId: seriesCcd.padreId,
      // Con SQL escrito a mano: en una consulta de una sola tabla, Drizzle escribe `${seriesCcd.id}` sin el nombre
      // de la tabla («id»), que dentro de la subconsulta sería el de `documentos` y contaría siempre cero.
      documentos: sql<number>`(select count(*)::int from documentos d where d.serie_id = series_ccd.id)`,
    })
    .from(seriesCcd)
    .orderBy(asc(seriesCcd.codigo));
  const codigoDe = new Map(filas.map((f) => [f.id, f.codigo]));
  return filas.map((f) => ({
    id: f.id,
    codigo: f.codigo,
    nombre: f.nombre,
    padreCodigo: f.padreId === null ? null : (codigoDe.get(f.padreId) ?? null),
    documentos: f.documentos,
  }));
}

export async function importarCuadro(db: BaseDatos, solicitud: SolicitudImportacion): Promise<ResultadoImportacion> {
  const opciones = { eliminarAusentes: solicitud.eliminarAusentes };

  if (!solicitud.aplicar) {
    return { plan: planificar(solicitud.filas, await leerCuadroActual(db), opciones), aplicado: false };
  }

  return db.transaction(async (tx) => {
    // Se bloquean todas las filas del cuadro (son pocas) ANTES de leer cuántos documentos tiene cada una.
    // Cargar un documento toma un bloqueo compartido de su subserie (por la clave foránea): quien cargue uno
    // mientras se importa espera a que termine, y un documento que se esté cargando en este instante termina
    // antes de que se cuente. Sin esto, «nunca mueve ni elimina una serie con documentos» tendría una carrera.
    await tx.execute(sql`select id from ${seriesCcd} for update`);

    const actuales = await leerCuadroActual(tx);
    const plan = planificar(solicitud.filas, actuales, opciones);
    if (plan.conflictos.length > 0 || !hayCambios(plan)) return { plan, aplicado: false };

    const idDe = new Map(actuales.map((s) => [s.codigo, s.id]));

    // 1. Series nuevas, y 2. nombres nuevos (no dependen de nada más).
    for (const fila of plan.crear.filter((f) => f.codigoPadre === null)) {
      const [creada] = await tx
        .insert(seriesCcd)
        .values({ codigo: fila.codigo, nombre: fila.nombre, padreId: null })
        .returning({ id: seriesCcd.id });
      idDe.set(fila.codigo, creada.id);
    }
    for (const renombre of plan.renombrar) {
      await tx.update(seriesCcd).set({ nombre: renombre.nombreNuevo }).where(eq(seriesCcd.codigo, renombre.codigo));
    }
    // 3. Subseries nuevas, 4. subseries que cambian de serie (la serie de destino ya existe).
    for (const fila of plan.crear.filter((f) => f.codigoPadre !== null)) {
      await tx
        .insert(seriesCcd)
        .values({ codigo: fila.codigo, nombre: fila.nombre, padreId: idDe.get(fila.codigoPadre as string) as number });
    }
    for (const movimiento of plan.mover) {
      await tx
        .update(seriesCcd)
        .set({ padreId: idDe.get(movimiento.padreNuevo) as number })
        .where(eq(seriesCcd.codigo, movimiento.codigo));
    }
    // 5. Eliminaciones: primero las subseries y después las series (el plan ya las trae en ese orden).
    for (const nivel of ['subserie', 'serie'] as const) {
      const ids = plan.eliminar.filter((a) => a.nivel === nivel).map((a) => idDe.get(a.codigo) as number);
      if (ids.length > 0) await tx.delete(seriesCcd).where(inArray(seriesCcd.id, ids));
    }

    await tx.insert(auditoria).values({
      usuarioId: null,
      accion: ACCION.CCD_IMPORTADO,
      detalle: detalleDeAuditoria(plan, solicitud),
    });
    return { plan, aplicado: true };
  });
}

/** Hasta cuántos códigos se nombran en el detalle de la auditoría por cada tipo de cambio. */
const CODIGOS_EN_DETALLE = 20;

function codigos(codigosDeCambio: string[]): string {
  const visibles = codigosDeCambio.slice(0, CODIGOS_EN_DETALLE).join(', ');
  const resto = codigosDeCambio.length - CODIGOS_EN_DETALLE;
  return resto > 0 ? `${visibles} y ${resto} más` : visibles;
}

/** Texto corto para `auditoria.detalle`: cuántas series se tocaron y cuáles se movieron o eliminaron. */
export function detalleDeAuditoria(plan: Plan, solicitud: Pick<SolicitudImportacion, 'origen' | 'eliminarAusentes'>): string {
  const series = plan.crear.filter((f) => f.codigoPadre === null).length;
  const partes = [
    `archivo ${solicitud.origen.archivo} (sha256 ${solicitud.origen.sha256})`,
    `creadas ${plan.crear.length} (${series} series, ${plan.crear.length - series} subseries)`,
    `renombradas ${plan.renombrar.length}`,
    `movidas ${plan.mover.length}${plan.mover.length > 0 ? ` (${codigos(plan.mover.map((m) => m.codigo))})` : ''}`,
    `eliminadas ${plan.eliminar.length}${plan.eliminar.length > 0 ? ` (${codigos(plan.eliminar.map((a: Ausente) => a.codigo))})` : ''}`,
    `ausentes conservadas ${plan.conservadas.length}`,
  ];
  if (solicitud.eliminarAusentes) partes.push('con --eliminar-ausentes');
  return partes.join('; ');
}
