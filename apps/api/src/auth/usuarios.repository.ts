import { and, eq } from 'drizzle-orm';
import { Inject, Injectable } from '@nestjs/common';
import { DB, type BaseDatos } from '../base-datos/base-datos.module.js';
import { usuarios } from '../base-datos/esquema.js';

/** Una transacción abierta con `enTransaccion`. */
export type Transaccion = Parameters<Parameters<BaseDatos['transaction']>[0]>[0];

export interface FilaUsuario {
  id: number;
  usuario: string;
  nombre: string;
  rol: 'administrador' | 'editor' | 'consulta';
  claveHash: string;
  activo: boolean;
  debeCambiarClave: boolean;
}

const columnas = {
  id: usuarios.id,
  usuario: usuarios.usuario,
  nombre: usuarios.nombre,
  rol: usuarios.rol,
  claveHash: usuarios.claveHash,
  activo: usuarios.activo,
  debeCambiarClave: usuarios.debeCambiarClave,
};

@Injectable()
export class UsuariosRepository {
  constructor(@Inject(DB) private readonly db: BaseDatos) {}

  enTransaccion<T>(trabajo: (tx: Transaccion) => Promise<T>): Promise<T> {
    return this.db.transaction(trabajo);
  }

  async buscarPorUsuario(usuario: string): Promise<FilaUsuario | undefined> {
    const [fila] = await this.db.select(columnas).from(usuarios).where(eq(usuarios.usuario, usuario)).limit(1);
    return fila;
  }

  async buscarPorId(id: number): Promise<FilaUsuario | undefined> {
    const [fila] = await this.db.select(columnas).from(usuarios).where(eq(usuarios.id, id)).limit(1);
    return fila;
  }

  /**
   * Cambia la clave de quien la está cambiando por voluntad propia, y apaga la marca de clave temporal.
   * Solo escribe si la clave guardada sigue siendo la que se verificó: si otra petición la cambió entre la
   * verificación y este momento (otro cambio a la vez, o un restablecimiento del administrador), no se
   * pisa nada y devuelve false. Así, dos cambios simultáneos con la misma clave actual dejan una sola clave
   * nueva y no depende de cuál escribió último.
   */
  async fijarClavePropia(
    tx: Transaccion,
    id: number,
    claveHashVerificada: string,
    claveHashNueva: string,
  ): Promise<boolean> {
    const filas = await tx
      .update(usuarios)
      .set({ claveHash: claveHashNueva, debeCambiarClave: false })
      .where(and(eq(usuarios.id, id), eq(usuarios.claveHash, claveHashVerificada), eq(usuarios.activo, true)))
      .returning({ id: usuarios.id });
    return filas.length === 1;
  }
}
