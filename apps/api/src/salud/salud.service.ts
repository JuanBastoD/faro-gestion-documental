import { readFileSync } from 'node:fs';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { POOL } from '../base-datos/base-datos.module.js';

/** Lo único que el servicio necesita de la conexión: así se prueba sin base real. */
export interface ConsultaBase {
  query(texto: string): Promise<unknown>;
}

export interface InformeSalud {
  /** "ok" si todo responde; "degradado" si algo falla (la API responde 503). */
  estado: 'ok' | 'degradado';
  api: { estado: 'ok'; version: string; uptimeSegundos: number };
  base: { estado: 'ok'; latenciaMs: number } | { estado: 'error' };
  momento: string;
}

const TIEMPO_MAXIMO_BASE_MS = 2000;

// Desde src/salud o dist/salud: ../../package.json es apps/api/package.json.
const VERSION: string = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
).version;

@Injectable()
export class SaludService {
  private readonly logger = new Logger(SaludService.name);

  constructor(@Inject(POOL) private readonly base: ConsultaBase) {}

  async verificar(): Promise<InformeSalud> {
    const base = await this.verificarBase();
    return {
      estado: base.estado === 'ok' ? 'ok' : 'degradado',
      api: {
        estado: 'ok',
        version: VERSION,
        uptimeSegundos: Math.round(process.uptime()),
      },
      base,
      momento: new Date().toISOString(),
    };
  }

  private async verificarBase(): Promise<InformeSalud['base']> {
    const inicio = performance.now();
    let temporizador: NodeJS.Timeout | undefined;
    try {
      const limite = new Promise<never>((_, rechazar) => {
        temporizador = setTimeout(
          () => rechazar(new Error(`sin respuesta en ${TIEMPO_MAXIMO_BASE_MS} ms`)),
          TIEMPO_MAXIMO_BASE_MS,
        );
      });
      await Promise.race([this.base.query('select 1'), limite]);
      return { estado: 'ok', latenciaMs: Math.round(performance.now() - inicio) };
    } catch (error) {
      // El detalle va al registro del servidor, no a la respuesta pública.
      const detalle = error instanceof Error ? error.message || error.name : String(error);
      this.logger.error(`La base de datos no responde: ${detalle}`);
      return { estado: 'error' };
    } finally {
      clearTimeout(temporizador);
    }
  }
}
