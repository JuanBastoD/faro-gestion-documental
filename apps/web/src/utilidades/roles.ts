import type { Rol } from '../api/auth';

/** Los tres roles, del que más puede al que menos. El orden es el de las listas de elección. */
export const ROLES: readonly Rol[] = ['administrador', 'editor', 'consulta'];

export const ETIQUETA_DE_ROL: Record<Rol, string> = {
  administrador: 'Administrador',
  editor: 'Editor',
  consulta: 'Consulta',
};

/** Qué puede y qué no puede cada rol, con las palabras de `docs/matriz-de-roles.md` (sección 3). */
export const DESCRIPCION_DE_ROL: Record<Rol, string> = {
  administrador: 'Todo: carga, versiona y restaura documentos, consulta la auditoría y administra usuarios.',
  editor: 'Carga documentos, sube versiones y restaura; lee y descarga todo. No ve la auditoría ni administra usuarios.',
  consulta: 'Solo lee, busca y descarga. No carga, no versiona, no ve la auditoría ni administra usuarios.',
};

/** Es uno de los tres roles (un valor que llega de un formulario o de la URL no tiene por qué serlo). */
export function esRol(valor: string): valor is Rol {
  return (ROLES as readonly string[]).includes(valor);
}
