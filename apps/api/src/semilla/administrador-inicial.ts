import { eq } from 'drizzle-orm';
import { ACCION } from '../auditoria/acciones.js';
import { hashear } from '../auth/hash-clave.js';
import type { BaseDatos } from '../base-datos/base-datos.module.js';
import { auditoria, usuarios } from '../base-datos/esquema.js';
import { leerNuevoUsuario } from '../usuarios/datos-usuario.js';

export interface DatosAdministradorInicial {
  usuario: string;
  nombre: string;
  clave: string;
}

/**
 * Crea el primer administrador de una instalación nueva (sin él nadie puede crear a los demás por la API).
 * Valida con las mismas reglas que `POST /usuarios`. Es seguro repetirlo: si el nombre ya existe no toca nada
 * y devuelve `false`. Deja un evento de auditoría sin autor (no hay nadie con sesión todavía).
 *
 * Lanza `BadRequestException` si los datos no cumplen las reglas; el mensaje nunca repite la clave.
 */
export async function crearAdministradorInicial(
  db: BaseDatos,
  datos: DatosAdministradorInicial,
): Promise<boolean> {
  const validos = leerNuevoUsuario({ ...datos, rol: 'administrador' });
  const [existente] = await db
    .select({ id: usuarios.id })
    .from(usuarios)
    .where(eq(usuarios.usuario, validos.usuario))
    .limit(1);
  if (existente) return false;

  // El hash es lento a propósito: se calcula antes de abrir la transacción.
  const claveHash = await hashear(validos.clave);
  await db.transaction(async (tx) => {
    const [creado] = await tx
      .insert(usuarios)
      .values({ usuario: validos.usuario, nombre: validos.nombre, rol: 'administrador', claveHash })
      .returning({ id: usuarios.id });
    await tx.insert(auditoria).values({
      usuarioId: null,
      accion: ACCION.USUARIO_CREADO,
      detalle: `usuario ${creado.id} (${validos.usuario}); rol administrador; primer administrador, creado por línea de comandos`,
    });
  });
  return true;
}
