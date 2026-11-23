import { and, eq, gt, lt } from 'drizzle-orm';
import { Inject, Injectable } from '@nestjs/common';
import { DB, type BaseDatos } from '../base-datos/base-datos.module.js';
import { sesiones, usuarios } from '../base-datos/esquema.js';
import type { UsuarioSesion } from './roles.js';

export interface SesionVigente {
  usuario: UsuarioSesion;
  ultimoUso: Date;
}

@Injectable()
export class SesionesRepository {
  constructor(@Inject(DB) private readonly db: BaseDatos) {}

  async crear(sesion: { id: string; usuarioId: number; venceEn: Date }): Promise<void> {
    await this.db.insert(sesiones).values(sesion);
  }

  /**
   * Una sesión sirve si no venció por inactividad, no superó la duración máxima
   * y su usuario sigue activo. Desactivar un usuario la invalida al instante.
   */
  async buscarVigente(
    id: string,
    ahora: Date,
    creadaDespuesDe: Date,
  ): Promise<SesionVigente | undefined> {
    const [fila] = await this.db
      .select({
        id: usuarios.id,
        usuario: usuarios.usuario,
        nombre: usuarios.nombre,
        rol: usuarios.rol,
        ultimoUso: sesiones.ultimoUso,
      })
      .from(sesiones)
      .innerJoin(usuarios, eq(usuarios.id, sesiones.usuarioId))
      .where(
        and(
          eq(sesiones.id, id),
          gt(sesiones.venceEn, ahora),
          gt(sesiones.creadaEn, creadaDespuesDe),
          eq(usuarios.activo, true),
        ),
      )
      .limit(1);
    if (!fila) return undefined;
    const { ultimoUso, ...usuario } = fila;
    return { usuario, ultimoUso };
  }

  async renovar(id: string, ahora: Date, venceEn: Date): Promise<void> {
    await this.db.update(sesiones).set({ ultimoUso: ahora, venceEn }).where(eq(sesiones.id, id));
  }

  async borrar(id: string): Promise<void> {
    await this.db.delete(sesiones).where(eq(sesiones.id, id));
  }

  /** Limpieza al ingresar: las sesiones vencidas de ese usuario ya no sirven para nada. */
  async borrarVencidasDe(usuarioId: number, ahora: Date): Promise<void> {
    await this.db
      .delete(sesiones)
      .where(and(eq(sesiones.usuarioId, usuarioId), lt(sesiones.venceEn, ahora)));
  }
}
