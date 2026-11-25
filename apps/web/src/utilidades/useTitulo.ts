import { useEffect } from 'react';

/** Pone el título de la pestaña (lo que un lector de pantalla anuncia al cambiar de pantalla). */
export function useTitulo(titulo: string): void {
  useEffect(() => {
    document.title = `${titulo} · Faro`;
  }, [titulo]);
}
