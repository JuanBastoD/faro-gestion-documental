interface Propiedades {
  pagina: number;
  tamano: number;
  total: number;
  alCambiar: (pagina: number) => void;
}

/** Cuántas páginas hay para `total` elementos. Siempre al menos una, aunque no haya resultados. */
export function totalDePaginas(total: number, tamano: number): number {
  return Math.max(1, Math.ceil(total / tamano));
}

/** Anterior y siguiente con «Página X de Y». Sin dependencias de la ruta: quien lo usa decide qué hace el cambio. */
export function Paginacion({ pagina, tamano, total, alCambiar }: Propiedades) {
  const paginas = totalDePaginas(total, tamano);
  if (paginas <= 1) return null;
  return (
    <nav aria-label="Paginación" className="paginacion">
      <button
        type="button"
        className="boton boton--secundario"
        disabled={pagina <= 1}
        onClick={() => alCambiar(pagina - 1)}
      >
        Anterior
      </button>
      <p className="paginacion__estado" aria-live="polite">
        Página {pagina} de {paginas}
      </p>
      <button
        type="button"
        className="boton boton--secundario"
        disabled={pagina >= paginas}
        onClick={() => alCambiar(pagina + 1)}
      >
        Siguiente
      </button>
    </nav>
  );
}
