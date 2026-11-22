import {
  BadRequestException,
  Injectable,
  type PipeTransform,
} from '@nestjs/common';
import { z } from 'zod';

const esquemaPaginacion = z.object({
  pagina: z.coerce
    .number({ error: 'pagina debe ser un número' })
    .int({ error: 'pagina debe ser entero' })
    .min(1, { error: 'pagina empieza en 1' })
    .default(1),
  tamano: z.coerce
    .number({ error: 'tamano debe ser un número' })
    .int({ error: 'tamano debe ser entero' })
    .min(1, { error: 'tamano empieza en 1' })
    .max(50, { error: 'tamano no puede pasar de 50' })
    .default(20),
});

export function leerPaginacion(consulta: unknown): { pagina: number; tamano: number } {
  const resultado = esquemaPaginacion.safeParse(consulta ?? {});
  if (resultado.success) return resultado.data;
  const problemas = resultado.error.issues.map((p) => `${p.path.join('.')}: ${p.message}`);
  throw new BadRequestException({
    message: `Parámetros inválidos: ${problemas.join('; ')}`,
    problemas,
  });
}

const MAXIMO_ENTERO_POSTGRES = 2_147_483_647;

/** Identificador numérico de la URL: entero entre 1 y el máximo de un integer de PostgreSQL. */
@Injectable()
export class IdentificadorPipe implements PipeTransform<string, number> {
  transform(valor: string): number {
    if (!/^\d{1,10}$/.test(valor)) {
      throw new BadRequestException('El identificador debe ser un número entero positivo');
    }
    const numero = Number(valor);
    if (numero < 1 || numero > MAXIMO_ENTERO_POSTGRES) {
      throw new BadRequestException('El identificador está fuera de rango');
    }
    return numero;
  }
}
