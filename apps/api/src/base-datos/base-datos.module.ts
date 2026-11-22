import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { ENTORNO } from '../config/config.module.js';
import type { Entorno } from '../config/entorno.js';
import * as esquema from './esquema.js';

/** Tokens de inyección: @Inject(POOL) y @Inject(DB). */
export const POOL = Symbol('POOL');
export const DB = Symbol('DB');

export type BaseDatos = NodePgDatabase<typeof esquema>;

@Global()
@Module({
  providers: [
    {
      provide: POOL,
      inject: [ENTORNO],
      useFactory: (entorno: Entorno): pg.Pool => {
        const pool = new pg.Pool({
          connectionString: entorno.DATABASE_URL,
          max: 10,
          connectionTimeoutMillis: 3000,
          idleTimeoutMillis: 30000,
        });
        // Sin este manejador, un error en una conexión ociosa tumba el proceso.
        pool.on('error', (error) => {
          new Logger('BaseDatos').error(`Error en una conexión inactiva: ${error.message}`);
        });
        return pool;
      },
    },
    {
      provide: DB,
      inject: [POOL],
      useFactory: (pool: pg.Pool): BaseDatos => drizzle(pool, { schema: esquema }),
    },
  ],
  exports: [POOL, DB],
})
export class BaseDatosModule implements OnApplicationShutdown {
  constructor(@Inject(POOL) private readonly pool: pg.Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
