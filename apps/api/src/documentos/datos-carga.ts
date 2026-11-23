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

export const esquemaCarga = z.object({
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
    .transform((motivo) => (motivo ? motivo : MOTIVO_CARGA_INICIAL)),
});

export type DatosCarga = z.infer<typeof esquemaCarga>;

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
