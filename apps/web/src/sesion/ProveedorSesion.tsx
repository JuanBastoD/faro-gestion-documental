import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ingresar as ingresarEnLaApi, quienSoy, salir as salirEnLaApi } from '../api/auth';
import { alExpirarLaSesion } from '../api/cliente';
import { ContextoSesion, type EstadoDeSesion, type ValorDeSesion } from './contexto';

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<EstadoDeSesion>({ tipo: 'cargando' });

  // Al abrir la interfaz: ¿hay una sesión vigente? La cookie es HttpOnly, así que solo la API lo sabe.
  useEffect(() => {
    const control = new AbortController();
    quienSoy(control.signal).then(
      (usuario) => setEstado(usuario ? { tipo: 'autenticado', usuario } : { tipo: 'anonimo', expirada: false }),
      () => {
        // Sin red o con la API caída no hay sesión que mostrar: el ingreso dirá qué pasa al intentarlo.
        if (!control.signal.aborted) setEstado({ tipo: 'anonimo', expirada: false });
      },
    );
    return () => control.abort();
  }, []);

  // Un 401 en cualquier petición con sesión: volver al ingreso (lo hace la guarda de rutas al ver `anonimo`).
  useEffect(
    () =>
      alExpirarLaSesion(() =>
        setEstado((actual) => (actual.tipo === 'autenticado' ? { tipo: 'anonimo', expirada: true } : actual)),
      ),
    [],
  );

  const ingresar = useCallback(async (usuario: string, clave: string) => {
    const datos = await ingresarEnLaApi(usuario, clave);
    setEstado({ tipo: 'autenticado', usuario: datos });
  }, []);

  const salir = useCallback(async () => {
    try {
      await salirEnLaApi();
    } catch {
      // Si el servidor no contesta, igual se sale de la interfaz: la cookie vence sola (ADR-003).
    }
    setEstado({ tipo: 'anonimo', expirada: false });
  }, []);

  const refrescar = useCallback(async () => {
    try {
      const usuario = await quienSoy();
      setEstado((actual) => {
        if (usuario) return { tipo: 'autenticado', usuario };
        // Había sesión y la API ya no la reconoce: vuelve al ingreso con el aviso, como ante un 401.
        return actual.tipo === 'autenticado' ? { tipo: 'anonimo', expirada: true } : actual;
      });
    } catch {
      // Sin red (o 5xx) no se sabe nada nuevo: se conserva lo que había; la siguiente petición dirá qué pasa.
    }
  }, []);

  const valor = useMemo<ValorDeSesion>(() => ({ estado, ingresar, salir, refrescar }), [estado, ingresar, salir, refrescar]);
  return <ContextoSesion.Provider value={valor}>{children}</ContextoSesion.Provider>;
}
