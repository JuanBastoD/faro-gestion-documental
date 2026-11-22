import { hashear } from '../auth/hash-clave.js';
import type { Rol } from '../auth/roles.js';
import type { BaseDatos } from '../base-datos/base-datos.module.js';
import { usuarios } from '../base-datos/esquema.js';

/** Personas ficticias, una por rol. Solo para desarrollo y pruebas, nunca datos reales. */
export const USUARIOS_DEMO: ReadonlyArray<{ usuario: string; nombre: string; rol: Rol }> = [
  { usuario: 'admin.demo', nombre: 'Administración Demo', rol: 'administrador' },
  { usuario: 'editor.demo', nombre: 'Editor Demo', rol: 'editor' },
  { usuario: 'consulta.demo', nombre: 'Consulta Demo', rol: 'consulta' },
];

/**
 * Crea los usuarios de demostración que falten. Es repetible y no toca a los que ya
 * existen: no les cambia la clave ni el rol. Devuelve cuántos creó.
 */
export async function sembrarUsuariosDemo(db: BaseDatos, clave: string): Promise<number> {
  const claveHash = await hashear(clave);
  const creados = await db
    .insert(usuarios)
    .values(USUARIOS_DEMO.map((u) => ({ ...u, claveHash })))
    .onConflictDoNothing({ target: usuarios.usuario })
    .returning({ id: usuarios.id });
  return creados.length;
}
