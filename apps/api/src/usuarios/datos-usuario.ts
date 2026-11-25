import { z } from 'zod';
import { esquemaClave, leer } from '../auth/datos-clave.js';
import { ROLES, type Rol } from '../auth/roles.js';

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
  clave: esquemaClave,
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

export const leerNuevoUsuario = (cuerpo: unknown): NuevoUsuario => leer(esquemaNuevoUsuario, cuerpo);
export const leerCambioDeUsuario = (cuerpo: unknown): CambioDeUsuario => leer(esquemaCambio, cuerpo);
