import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

/**
 * Largo de las claves que fija alguien: la de un usuario nuevo, la temporal del administrador y la que cada
 * persona elige al cambiarla (ADR-008 y ADR-011). El máximo evita hacer trabajar al hash con cuerpos enormes.
 */
export const CLAVE_MINIMA = 12;
export const CLAVE_MAXIMA = 256;

/** Una clave que se va a guardar: la misma regla en todos los lugares donde alguien la fija. */
export const esquemaClave = z
  .string({ error: 'es obligatoria' })
  .min(CLAVE_MINIMA, { error: `debe tener al menos ${CLAVE_MINIMA} caracteres` })
  .max(CLAVE_MAXIMA, { error: `no puede pasar de ${CLAVE_MAXIMA} caracteres` })
  .refine((clave) => clave.trim() !== '', { error: 'no puede ser solo espacios' });

const esquemaCambioDeClave = z
  .strictObject({
    // Basta con que no esté vacía: la clave actual se compara con el hash, no se le exigen reglas de largo
    // (las claves antiguas pudieron nacer con otras reglas). El tope es el mismo del ingreso.
    claveActual: z
      .string({ error: 'es obligatoria' })
      .min(1, { error: 'es obligatoria' })
      .max(CLAVE_MAXIMA, { error: `no puede pasar de ${CLAVE_MAXIMA} caracteres` }),
    claveNueva: esquemaClave,
  })
  .refine((datos) => datos.claveNueva !== datos.claveActual, {
    // Dos textos iguales son la misma clave: se sabe sin verificar nada y sin delatar si la actual es correcta.
    path: ['claveNueva'],
    error: 'debe ser distinta de la clave actual',
  });

const esquemaClaveTemporal = z.strictObject({ clave: esquemaClave });

export interface CambioDeClave {
  claveActual: string;
  claveNueva: string;
}

/**
 * Valida un cuerpo con un esquema zod y lanza 400 con los motivos. Los mensajes salen del esquema y nunca
 * incluyen lo que se escribió (puede ser una clave).
 */
export function leer<T>(esquema: z.ZodType<T>, cuerpo: unknown): T {
  const resultado = esquema.safeParse(cuerpo ?? {});
  if (resultado.success) return resultado.data;
  const problemas = resultado.error.issues.map((p) => {
    const campo = p.path.join('.');
    const texto = p.code === 'unrecognized_keys' ? `campos no admitidos: ${p.keys.join(', ')}` : p.message;
    return campo ? `${campo}: ${texto}` : texto;
  });
  throw new BadRequestException({ message: `Datos inválidos: ${problemas.join('; ')}`, problemas });
}

export const leerCambioDeClave = (cuerpo: unknown): CambioDeClave => leer(esquemaCambioDeClave, cuerpo);
export const leerClaveTemporal = (cuerpo: unknown): string => leer(esquemaClaveTemporal, cuerpo).clave;
