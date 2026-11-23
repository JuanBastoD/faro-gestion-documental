import { sql } from 'drizzle-orm';
import { Inject, Injectable } from '@nestjs/common';
import { DB, type BaseDatos } from '../base-datos/base-datos.module.js';
import { intentosIngreso } from '../base-datos/esquema.js';

export interface ConteoIntentos {
  porUsuario: number;
  porIp: number;
  /** Segundos hasta que venza el intento más antiguo de ese usuario dentro de la ventana (0 si no hay). */
  esperaUsuarioSeg: number;
  esperaIpSeg: number;
}

/**
 * Acceso a `intentos_ingreso` (ADR-009). Toda la aritmética de tiempo se hace con el reloj de PostgreSQL
 * (`now()`), no con el del proceso: con varias instancias de la API, un solo reloj decide quién está dentro
 * de la ventana.
 */
@Injectable()
export class IntentosIngresoRepository {
  constructor(@Inject(DB) private readonly db: BaseDatos) {}

  async registrar(usuario: string, ip: string): Promise<void> {
    await this.db.insert(intentosIngreso).values({ usuario, ip });
  }

  /** Cuenta los intentos de la ventana por usuario y por IP, en una sola consulta. */
  async contar(usuario: string, ip: string, ventanaSeg: number): Promise<ConteoIntentos> {
    const { rows } = await this.db.execute<{
      por_usuario: number;
      por_ip: number;
      espera_usuario: number;
      espera_ip: number;
    }>(sql`
      select
        (count(*) filter (where usuario = ${usuario}))::int as por_usuario,
        (count(*) filter (where ip = ${ip}))::int as por_ip,
        coalesce(ceil(extract(epoch from (
          min(creado_en) filter (where usuario = ${usuario}) + make_interval(secs => ${ventanaSeg}::double precision) - now()
        ))), 0)::int as espera_usuario,
        coalesce(ceil(extract(epoch from (
          min(creado_en) filter (where ip = ${ip}) + make_interval(secs => ${ventanaSeg}::double precision) - now()
        ))), 0)::int as espera_ip
      from intentos_ingreso
      where creado_en > now() - make_interval(secs => ${ventanaSeg}::double precision)
        and (usuario = ${usuario} or ip = ${ip})
    `);
    const fila = rows[0];
    return {
      porUsuario: fila.por_usuario,
      porIp: fila.por_ip,
      esperaUsuarioSeg: fila.espera_usuario,
      esperaIpSeg: fila.espera_ip,
    };
  }

  /** Tras un ingreso correcto: el usuario vuelve a empezar de cero. */
  async olvidarUsuario(usuario: string): Promise<void> {
    await this.db.execute(sql`delete from intentos_ingreso where usuario = ${usuario}`);
  }

  /** Borra lo que ya no cuenta para nada (más viejo que un día). */
  async purgarAntiguos(): Promise<void> {
    await this.db.execute(sql`delete from intentos_ingreso where creado_en < now() - interval '1 day'`);
  }
}
