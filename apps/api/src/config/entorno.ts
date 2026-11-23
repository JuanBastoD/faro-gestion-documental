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
  // Dónde se guardan los PDF: en una carpeta del equipo (desarrollo y pruebas) o en un almacén S3.
  ALMACEN_TIPO: z.enum(['disco', 's3'], { error: 'debe ser disco o s3' }).default('disco'),
  ALMACEN_RUTA: z.string().min(1, { error: 'no puede estar vacía' }).default('almacen-local'),
  // Desde qué similitud de texto (0,5 a 1) se avisa de un duplicado probable. Ver ADR-006: el 0,80 es
  // un valor inicial que hay que calibrar con PDF reales de la entidad.
  UMBRAL_SIMILITUD: z.coerce
    .number({ error: 'debe ser un número entre 0,5 y 1' })
    .min(0.5, { error: 'debe ser un número entre 0,5 y 1' })
    .max(1, { error: 'debe ser un número entre 0,5 y 1' })
    .default(0.8),
  S3_ENDPOINT: z
    .string()
    .refine((valor) => /^https?:\/\//.test(valor) && URL.canParse(valor), {
      error: 'debe ser una URL que empiece por http:// o https://',
    })
    .optional(),
  S3_REGION: z.string().min(1, { error: 'no puede estar vacía' }).default('us-east-1'),
  S3_BUCKET: z.string().min(1, { error: 'no puede estar vacío' }).optional(),
  S3_ACCESS_KEY: z.string().min(1, { error: 'no puede estar vacía' }).optional(),
  S3_SECRET_KEY: z.string().min(1, { error: 'no puede estar vacía' }).optional(),
}).superRefine((valores, contexto) => {
  if (valores.ALMACEN_TIPO !== 's3') return;
  for (const nombre of ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'] as const) {
    if (!valores[nombre]) {
      contexto.addIssue({
        code: 'custom',
        path: [nombre],
        message: 'es obligatoria cuando ALMACEN_TIPO=s3',
      });
    }
  }
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
