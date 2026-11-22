import { eq } from 'drizzle-orm';
import { Inject, Injectable } from '@nestjs/common';
import { DB, type BaseDatos } from '../base-datos/base-datos.module.js';
import { usuarios } from '../base-datos/esquema.js';

export interface FilaUsuario {
  id: number;
  usuario: string;
  nombre: string;
  rol: 'administrador' | 'editor' | 'consulta';
  claveHash: string;
  activo: boolean;
}

@Injectable()
export class UsuariosRepository {
  constructor(@Inject(DB) private readonly db: BaseDatos) {}

  async buscarPorUsuario(usuario: string): Promise<FilaUsuario | undefined> {
    const [fila] = await this.db
      .select({
        id: usuarios.id,
        usuario: usuarios.usuario,
        nombre: usuarios.nombre,
        rol: usuarios.rol,
        claveHash: usuarios.claveHash,
        activo: usuarios.activo,
      })
      .from(usuarios)
      .where(eq(usuarios.usuario, usuario))
      .limit(1);
    return fila;
  }
}
