import { useEffect, type RefObject } from 'react';

/**
 * Cuando `intento` sube (la persona intentó enviar y hubo errores), pasa el foco al primer control con error dentro de
 * `contenedor`: un control marcado con `aria-invalid="true"`, o el primero de un grupo con `data-error="true"` (los
 * botones de opción no admiten `aria-invalid`). Con teclado o lector de pantalla es lo que hace que el error se note.
 */
export function useEnfocarPrimerError(contenedor: RefObject<HTMLElement | null>, intento: number): void {
  useEffect(() => {
    if (intento === 0) return;
    contenedor.current?.querySelector<HTMLElement>('[aria-invalid="true"], [data-error="true"]')?.focus();
  }, [contenedor, intento]);
}
