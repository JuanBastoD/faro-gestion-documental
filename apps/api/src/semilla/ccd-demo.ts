import { sql } from 'drizzle-orm';
import type { BaseDatos } from '../base-datos/base-datos.module.js';
import { seriesCcd } from '../base-datos/esquema.js';

/**
 * [SUPUESTO] Cuadro de ejemplo para desarrollo y pruebas. No es un instrumento aprobado
 * por la entidad: las TRD y TVD definitivas corresponden al Comité de Archivo.
 * Es el mismo del prototipo v1.
 */
export const CCD_DEMO: ReadonlyArray<{
  codigo: string;
  nombre: string;
  subseries: ReadonlyArray<{ codigo: string; nombre: string }>;
}> = [
  {
    codigo: '100',
    nombre: 'Gestión contractual',
    subseries: [
      { codigo: '100.1', nombre: 'Contratos de obra' },
      { codigo: '100.2', nombre: 'Interventoría' },
    ],
  },
  {
    codigo: '200',
    nombre: 'Gestión jurídica',
    subseries: [{ codigo: '200.1', nombre: 'Conceptos jurídicos' }],
  },
  {
    codigo: '300',
    nombre: 'Gestión financiera',
    subseries: [{ codigo: '300.1', nombre: 'Certificados de disponibilidad' }],
  },
  {
    codigo: '400',
    nombre: 'Gestión administrativa',
    subseries: [{ codigo: '400.1', nombre: 'Actas de comité' }],
  },
];

/**
 * Crea las series y subseries que falten y corrige el nombre de las que ya existen.
 * Es repetible. Devuelve cuántas filas del cuadro hay después de sembrar.
 */
export async function sembrarCcdDemo(db: BaseDatos): Promise<number> {
  let total = 0;
  for (const serie of CCD_DEMO) {
    const [raiz] = await db
      .insert(seriesCcd)
      .values({ codigo: serie.codigo, nombre: serie.nombre, padreId: null })
      .onConflictDoUpdate({ target: seriesCcd.codigo, set: { nombre: serie.nombre } })
      .returning({ id: seriesCcd.id });
    total += 1;
    for (const sub of serie.subseries) {
      await db
        .insert(seriesCcd)
        .values({ codigo: sub.codigo, nombre: sub.nombre, padreId: raiz.id })
        .onConflictDoUpdate({
          target: seriesCcd.codigo,
          // Solo el nombre: no se mueve de padre una subserie que ya existe.
          set: { nombre: sub.nombre },
        });
      total += 1;
    }
  }
  return total;
}

/** Cuántas filas del cuadro tienen un código del cuadro de demostración. Útil para verificar. */
export async function contarCcdDemo(db: BaseDatos): Promise<number> {
  const codigos = CCD_DEMO.flatMap((s) => [s.codigo, ...s.subseries.map((x) => x.codigo)]);
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(seriesCcd)
    .where(sql`${seriesCcd.codigo} in ${codigos}`);
  return n;
}
