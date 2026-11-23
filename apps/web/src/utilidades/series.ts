import type { Serie } from '../api/series';

/** «código · nombre» de la subserie con ese código, o el código solo si el cuadro no la trae. */
export function nombreDeSubseriePorCodigo(series: readonly Serie[], codigo: string): string {
  for (const serie of series) {
    const subserie = serie.subseries.find((s) => s.codigo === codigo);
    if (subserie) return `${subserie.codigo} · ${subserie.nombre}`;
  }
  return codigo;
}

/** «código · nombre» de la subserie con ese identificador, o `undefined` si el cuadro no la trae. */
export function nombreDeSubseriePorId(series: readonly Serie[], id: number): string | undefined {
  for (const serie of series) {
    const subserie = serie.subseries.find((s) => s.id === id);
    if (subserie) return `${subserie.codigo} · ${subserie.nombre}`;
  }
  return undefined;
}
