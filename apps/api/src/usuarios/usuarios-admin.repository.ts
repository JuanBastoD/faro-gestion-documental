import { and, asc, eq, sql } from 'drizzle-orm';
import { Inject, Injectable } from '@nestjs/common';
import type { Rol } from '../auth/roles.js';
import { DB, type BaseDatos } from '../base-datos/base-datos.module.js';
import { sesiones, usuarios } from '../base-datos/esquema.js';

/** Una transacción abierta con `enTransaccion`. */
export type Transaccion = Parameters<Parameters<BaseDatos['transaction']>[0]>[0];

/** Lo que la administración ve de un usuario. Nunca incluye el hash de la clave. */
export interface UsuarioAdministrado {
  id: number;
  usuario: string;
  nombre: string;
  rol: Rol;
  activo: boolean;
  creadoEn: Date;
}

/** Nombre del candado consultivo que pone en fila los cambios que pueden quitar administradores. */
const CANDADO_ADMINISTRADORES = 'faro.usuarios.administradores';

/** Códigos de PostgreSQL por los que se repite la transacción entera: abrazo mortal (deadlock) y fallo de serialización. */
const REPETIBLES = new Set(['40P01', '40001']);
/** Intentos en total: el primero y dos repeticiones. */
export const INTENTOS_DE_TRANSACCION = 3;

function esRepetible(error: unknown): boolean {
  // Drizzle envuelve el error de pg: el código puede estar en el error o en su causa.
  const e = error as { code?: string; cause?: { code?: string } } | null;
  return REPETIBLES.has(e?.code ?? '') || REPETIBLES.has(e?.cause?.code ?? '');
}

const columnas = {
  id: usuarios.id,
  usuario: usuarios.usuario,
  nombre: usuarios.nombre,
  rol: usuarios.rol,
  activo: usuarios.activo,
  creadoEn: usuarios.creadoEn,
};

@Injectable()
export class UsuariosAdminRepository {
  constructor(@Inject(DB) private readonly db: BaseDatos) {}

  /**
   * Abre una transacción. Si PostgreSQL la aborta por un abrazo mortal o un fallo de serialización (40P01, 40001), ya se deshizo
   * entera y se repite desde el principio, hasta 3 intentos en total. `trabajo` solo debe tocar la base (nada de archivos, correo
   * ni contadores en memoria), así que repetirlo es seguro. Cualquier otro error sale tal cual, sin repetir.
   */
  async enTransaccion<T>(trabajo: (tx: Transaccion) => Promise<T>): Promise<T> {
    for (let intento = 1; ; intento++) {
      try {
        return await this.db.transaction(trabajo);
      } catch (error) {
        if (intento >= INTENTOS_DE_TRANSACCION || !esRepetible(error)) throw error;
        // Una pausa corta y distinta en cada repetición, para que no vuelvan a chocar en el mismo instante.
        await new Promise((seguir) => setTimeout(seguir, 20 * intento + Math.random() * 30));
      }
    }
  }

  listar(): Promise<UsuarioAdministrado[]> {
    return this.db.select(columnas).from(usuarios).orderBy(asc(usuarios.id));
  }

  async insertar(
    tx: Transaccion,
    datos: { usuario: string; nombre: string; rol: Rol; claveHash: string },
  ): Promise<UsuarioAdministrado> {
    const [fila] = await tx.insert(usuarios).values(datos).returning(columnas);
    return fila;
  }

  /** Lee y bloquea la fila: otro cambio del mismo usuario espera a que esta transacción termine. */
  async buscarBloqueando(tx: Transaccion, id: number): Promise<UsuarioAdministrado | undefined> {
    const [fila] = await tx.select(columnas).from(usuarios).where(eq(usuarios.id, id)).for('update');
    return fila;
  }

  /**
   * Bloquea a todos los administradores activos y devuelve sus ids. Dos cambios que podrían quitar
   * administradores (desactivar o degradar) se ponen en fila aquí, así cada uno cuenta a los que
   * quedan después del anterior y el sistema no puede quedarse sin ninguno.
   *
   * Lo primero es un candado consultivo de transacción que serializa por completo estos cambios (son raros). El orden de los
   * bloqueos de fila no alcanza: en READ COMMITTED, si otra transacción cambió una fila mientras esta esperaba, el bloqueo queda
   * puesto aunque la fila ya no cumpla el filtro, y la auditoría pide al final, por la clave foránea, un bloqueo sobre la fila de
   * quien actúa (que puede no estar entre los administradores). Dos transacciones se podían esperar mutuamente (ADR-008, nota
   * del 23 de noviembre de 2026). Todo código que cambie rol o estado debe llamar a este método antes de bloquear nada más.
   */
  async bloquearAdministradoresActivos(tx: Transaccion): Promise<number[]> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${CANDADO_ADMINISTRADORES}, 0))`);
    const filas = await tx
      .select({ id: usuarios.id })
      .from(usuarios)
      .where(and(eq(usuarios.rol, 'administrador'), eq(usuarios.activo, true)))
      .orderBy(asc(usuarios.id))
      .for('update');
    return filas.map((f) => f.id);
  }

  async actualizar(
    tx: Transaccion,
    id: number,
    cambios: { rol?: Rol; activo?: boolean },
  ): Promise<UsuarioAdministrado> {
    const [fila] = await tx.update(usuarios).set(cambios).where(eq(usuarios.id, id)).returning(columnas);
    return fila;
  }

  /** Borra las sesiones del usuario y dice cuántas había. */
  async borrarSesiones(tx: Transaccion, usuarioId: number): Promise<number> {
    const borradas = await tx
      .delete(sesiones)
      .where(eq(sesiones.usuarioId, usuarioId))
      .returning({ id: sesiones.id });
    return borradas.length;
  }
}
