import { z } from 'zod';

/**
 * Variables de entorno que la API necesita para arrancar.
 * Se validan al inicio: si falta o sobra algo, la API no arranca y dice qué corregir.
 */
const esquema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'], {
      error: 'debe ser development, test o production',
    })
    .default('development'),
  // Dirección donde escucha. Por defecto solo este equipo; en contenedor se pone 0.0.0.0.
  HOST: z.string().min(1, { error: 'no puede estar vacía' }).default('127.0.0.1'),
  PORT: z.coerce
    .number({ error: 'debe ser un número' })
    .int({ error: 'debe ser un entero' })
    .min(1, { error: 'debe estar entre 1 y 65535' })
    .max(65535, { error: 'debe estar entre 1 y 65535' })
    .default(3000),
  DATABASE_URL: z
    .string({ error: 'es obligatoria' })
    .min(1, { error: 'es obligatoria' })
    .refine((valor) => /^postgres(ql)?:\/\//.test(valor), {
      error: 'debe empezar por postgresql:// o postgres://',
    }),
});

export type Entorno = z.infer<typeof esquema>;

export class EntornoInvalidoError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'EntornoInvalidoError';
  }
}

/**
 * Valida y normaliza las variables de entorno.
 * El mensaje de error nombra las variables, pero nunca incluye sus valores
 * (DATABASE_URL lleva la clave de la base).
 */
export function validarEntorno(env: Record<string, string | undefined>): Entorno {
  const resultado = esquema.safeParse(env);
  if (resultado.success) {
    return resultado.data;
  }
  const problemas = resultado.error.issues.map(
    (problema) => `  - ${problema.path.join('.') || '(general)'}: ${problema.message}`,
  );
  throw new EntornoInvalidoError(
    `Configuración inválida. Revisa las variables de entorno (copia .env.example a .env):\n${problemas.join('\n')}`,
  );
}
