import { z } from 'zod';

/** "2026-11-22" y que sea una fecha real (no "2026-02-31"). */
const fechaCalendario = z
  .string({ error: 'es obligatoria' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'debe tener el formato AAAA-MM-DD' })
  .refine(
    (valor) => {
      const fecha = new Date(`${valor}T00:00:00Z`);
      return !Number.isNaN(fecha.getTime()) && fecha.toISOString().startsWith(valor);
    },
    { error: 'no es una fecha válida' },
  );

export const MOTIVO_CARGA_INICIAL = 'Carga inicial';

export const DECISION_NUEVA_VERSION = 'nueva_version';
export const DECISION_DOCUMENTO_DISTINTO = 'documento_distinto';

const esquemaBaseCarga = z.object({
  titulo: z
    .string({ error: 'es obligatorio' })
    .trim()
    .min(1, { error: 'es obligatorio' })
    .max(200, { error: 'no puede pasar de 200 caracteres' }),
  expediente: z
    .string({ error: 'es obligatorio' })
    .trim()
    .min(1, { error: 'es obligatorio' })
    .max(60, { error: 'no puede pasar de 60 caracteres' }),
  serieId: z.coerce
    .number({ error: 'debe ser un número' })
    .int({ error: 'debe ser un entero' })
    .min(1, { error: 'es obligatoria' }),
  fechaDocumento: fechaCalendario,
  motivo: z
    .string()
    .trim()
    .max(300, { error: 'no puede pasar de 300 caracteres' })
    .optional()
    // Un motivo vacío o de espacios cuenta como no dado.
    .transform((motivo) => (motivo ? motivo : undefined)),
  /**
   * Qué hace la persona ante un aviso de duplicado probable. Se reenvía el mismo archivo con la
   * decisión: así el servidor no guarda estados intermedios.
   */
  decision: z
    .enum([DECISION_NUEVA_VERSION, DECISION_DOCUMENTO_DISTINTO], {
      error: `debe ser ${DECISION_NUEVA_VERSION} o ${DECISION_DOCUMENTO_DISTINTO}`,
    })
    .optional(),
  /** Con `nueva_version`: el documento al que se agrega el archivo como versión. */
  documentoId: z.coerce
    .number({ error: 'debe ser un número' })
    .int({ error: 'debe ser un entero' })
    .min(1, { error: 'debe ser un identificador válido' })
    .optional(),
  /** Con `documento_distinto`: por qué no es un duplicado. Queda en la auditoría. */
  justificacion: z
    .string()
    .trim()
    .max(500, { error: 'no puede pasar de 500 caracteres' })
    .optional(),
});

export const esquemaCarga = esquemaBaseCarga.superRefine((datos, ctx) => {
  const problema = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
  if (datos.decision === DECISION_NUEVA_VERSION) {
    if (datos.documentoId === undefined) problema('documentoId', 'es obligatorio con decision=nueva_version');
    if (!datos.motivo) problema('motivo', 'es obligatorio con decision=nueva_version: explica qué cambió');
    if (datos.justificacion) problema('justificacion', 'solo aplica con decision=documento_distinto');
  } else if (datos.decision === DECISION_DOCUMENTO_DISTINTO) {
    if (!datos.justificacion) problema('justificacion', 'es obligatoria con decision=documento_distinto: explica por qué no es un duplicado');
    if (datos.documentoId !== undefined) problema('documentoId', 'solo aplica con decision=nueva_version');
  } else {
    if (datos.documentoId !== undefined) problema('documentoId', 'solo aplica con una decisión (nueva_version)');
    if (datos.justificacion) problema('justificacion', 'solo aplica con una decisión (documento_distinto)');
  }
});

export type DatosCarga = z.infer<typeof esquemaCarga>;

/** El motivo de una carga inicial, o el dado por la persona. */
export const motivoDe = (datos: DatosCarga): string => datos.motivo ?? MOTIVO_CARGA_INICIAL;

export class DatosInvalidosError extends Error {
  constructor(readonly problemas: string[]) {
    super(`Datos inválidos: ${problemas.join('; ')}`);
    this.name = 'DatosInvalidosError';
  }
}

export function leerDatosCarga(cuerpo: unknown): DatosCarga {
  const resultado = esquemaCarga.safeParse(cuerpo ?? {});
  if (resultado.success) return resultado.data;
  throw new DatosInvalidosError(
    resultado.error.issues.map((p) => `${p.path.join('.') || 'cuerpo'}: ${p.message}`),
  );
}
