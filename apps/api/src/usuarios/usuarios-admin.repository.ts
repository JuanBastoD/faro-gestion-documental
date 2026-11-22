import { and, asc, eq } from 'drizzle-orm';
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

  enTransaccion<T>(trabajo: (tx: Transaccion) => Promise<T>): Promise<T> {
    return this.db.transaction(trabajo);
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
   */
  async bloquearAdministradoresActivos(tx: Transaccion): Promise<number[]> {
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
