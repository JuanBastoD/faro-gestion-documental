import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { ROLES, type Rol } from '../auth/roles.js';

/** Largo mínimo de la clave que fija un administrador. El máximo evita hacer trabajar al hash con cuerpos enormes. */
export const CLAVE_MINIMA = 12;
export const CLAVE_MAXIMA = 256;

const MENSAJE_USUARIO =
  'de 3 a 64 caracteres: minúsculas, números, punto, guion y guion bajo, empezando con letra o número';

const esquemaNuevoUsuario = z.strictObject({
  // Solo minúsculas: el ingreso compara el nombre tal cual, y así «Ana» y «ana» no pueden ser dos cuentas ni confundirse.
  usuario: z
    .string({ error: 'es obligatorio' })
    .trim()
    .regex(/^[a-z0-9][a-z0-9._-]{2,63}$/, { error: MENSAJE_USUARIO }),
  nombre: z
    .string({ error: 'es obligatorio' })
    .trim()
    .min(1, { error: 'es obligatorio' })
    .max(120, { error: 'no puede pasar de 120 caracteres' }),
  rol: z.enum(ROLES, { error: `debe ser uno de: ${ROLES.join(', ')}` }),
  clave: z
    .string({ error: 'es obligatoria' })
    .min(CLAVE_MINIMA, { error: `debe tener al menos ${CLAVE_MINIMA} caracteres` })
    .max(CLAVE_MAXIMA, { error: `no puede pasar de ${CLAVE_MAXIMA} caracteres` })
    .refine((clave) => clave.trim() !== '', { error: 'no puede ser solo espacios' }),
});

const esquemaCambio = z
  .strictObject({
    rol: z.enum(ROLES, { error: `debe ser uno de: ${ROLES.join(', ')}` }).optional(),
    activo: z.boolean({ error: 'debe ser true o false' }).optional(),
  })
  .refine((datos) => datos.rol !== undefined || datos.activo !== undefined, {
    error: 'indica al menos rol o activo',
  });

export interface NuevoUsuario {
  usuario: string;
  nombre: string;
  rol: Rol;
  clave: string;
}

export interface CambioDeUsuario {
  rol?: Rol;
  activo?: boolean;
}

function leer<T>(esquema: z.ZodType<T>, cuerpo: unknown): T {
  const resultado = esquema.safeParse(cuerpo ?? {});
  if (resultado.success) return resultado.data;
  // Los mensajes salen del esquema y nunca incluyen lo que se escribió (puede ser una clave).
  const problemas = resultado.error.issues.map((p) => {
    const campo = p.path.join('.');
    const texto = p.code === 'unrecognized_keys' ? `campos no admitidos: ${p.keys.join(', ')}` : p.message;
    return campo ? `${campo}: ${texto}` : texto;
  });
  throw new BadRequestException({ message: `Datos inválidos: ${problemas.join('; ')}`, problemas });
}

export const leerNuevoUsuario = (cuerpo: unknown): NuevoUsuario => leer(esquemaNuevoUsuario, cuerpo);
export const leerCambioDeUsuario = (cuerpo: unknown): CambioDeUsuario => leer(esquemaCambio, cuerpo);
