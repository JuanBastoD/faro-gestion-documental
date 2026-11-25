import { pedir } from './cliente';

export interface Subserie {
  id: number;
  codigo: string;
  nombre: string;
}

/** Una serie del cuadro de clasificación con sus subseries (árbol de dos niveles). */
export interface Serie extends Subserie {
  subseries: Subserie[];
}

/** `GET /series`: el cuadro de clasificación como árbol. Cualquier rol con sesión. */
export function listarSeries(senal?: AbortSignal): Promise<Serie[]> {
  return pedir<Serie[]>('/series', { senal });
}
