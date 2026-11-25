import { useCallback, useEffect, useState } from 'react';

export type Carga<T> =
  | { tipo: 'cargando' }
  | { tipo: 'error'; error: unknown }
  | { tipo: 'listo'; datos: T };

/**
 * Pide datos a la API mientras la pantalla está montada y mientras `cargador` no cambie. Devuelve el estado de la
 * carga y una función para reintentarla.
 *
 * `cargador` debe estar envuelto en `useCallback` con lo que cambie la consulta (texto buscado, página, id...):
 * cuando cambia, se cancela la petición anterior y el resultado vuelve a `cargando` hasta que llegue el nuevo.
 * El resultado guardado va atado a la identidad del `cargador` (y al número de reintento) que lo produjo, así que una
 * respuesta tardía de una consulta anterior nunca se muestra como si fuera de la actual, y no hace falta un
 * `setState` síncrono dentro del efecto para marcar «cargando».
 */
export function useCarga<T>(cargador: (senal: AbortSignal) => Promise<T>): [Carga<T>, () => void] {
  const [intento, setIntento] = useState(0);
  const [resultado, setResultado] = useState<{
    cargador: typeof cargador;
    intento: number;
    carga: Carga<T>;
  } | null>(null);

  useEffect(() => {
    const control = new AbortController();
    cargador(control.signal).then(
      (datos) => {
        if (!control.signal.aborted) setResultado({ cargador, intento, carga: { tipo: 'listo', datos } });
      },
      (error: unknown) => {
        if (!control.signal.aborted) setResultado({ cargador, intento, carga: { tipo: 'error', error } });
      },
    );
    return () => control.abort();
  }, [cargador, intento]);

  const reintentar = useCallback(() => setIntento((n) => n + 1), []);
  const vigente = resultado !== null && resultado.cargador === cargador && resultado.intento === intento;
  return [vigente ? resultado.carga : { tipo: 'cargando' }, reintentar];
}
