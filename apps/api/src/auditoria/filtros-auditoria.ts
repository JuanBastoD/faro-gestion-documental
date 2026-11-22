import { z } from 'zod';
import { ACCION } from './acciones.js';

const TAMANO_POR_DEFECTO = 20;
const TAMANO_MAXIMO = 100;

/** Entero positivo que llega como texto en la URL. */
const entero = (nombre: string) =>
  z.coerce.number({ error: `${nombre} debe ser un número` }).int({ error: `${nombre} debe ser entero` });

/** Fecha ISO 8601 (por ejemplo 2026-11-22 o 2026-11-22T10:00:00Z). */
const fecha = (nombre: string) =>
  z.coerce.date({ error: `${nombre} debe ser una fecha ISO 8601` });

export const esquemaFiltros = z
  .object({
    usuarioId: entero('usuarioId').min(1).optional(),
    accion: z.enum(Object.values(ACCION) as [string, ...string[]], { error: 'accion no es válida' }).optional(),
    documentoId: entero('documentoId').min(1).optional(),
    /** Desde esta fecha, incluida. */
    desde: fecha('desde').optional(),
    /** Hasta esta fecha, incluida. */
    hasta: fecha('hasta').optional(),
    pagina: entero('pagina').min(1, { error: 'pagina empieza en 1' }).default(1),
    tamano: entero('tamano')
      .min(1, { error: 'tamano empieza en 1' })
      .max(TAMANO_MAXIMO, { error: `tamano no puede pasar de ${TAMANO_MAXIMO}` })
      .default(TAMANO_POR_DEFECTO),
  })
  .refine((f) => !f.desde || !f.hasta || f.desde <= f.hasta, {
    error: 'desde no puede ser posterior a hasta',
    path: ['desde'],
  });

export type FiltrosAuditoria = z.infer<typeof esquemaFiltros>;

/** Valida los parámetros de la URL. Lanza un Error con la lista de problemas si algo está mal. */
export function leerFiltros(consulta: unknown): FiltrosAuditoria {
  const resultado = esquemaFiltros.safeParse(consulta);
  if (resultado.success) return resultado.data;
  const problemas = resultado.error.issues.map(
    (p) => `${p.path.join('.') || 'consulta'}: ${p.message}`,
  );
  throw new FiltrosInvalidosError(problemas);
}

export class FiltrosInvalidosError extends Error {
  constructor(readonly problemas: string[]) {
    super(`Parámetros inválidos: ${problemas.join('; ')}`);
    this.name = 'FiltrosInvalidosError';
  }
}
