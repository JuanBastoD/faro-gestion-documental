import { Navigate, Outlet, useLocation } from 'react-router';
import type { Rol } from '../api/auth';
import { SinPermiso } from '../paginas/SinPermiso';
import { useSesion } from './contexto';

/**
 * Guarda de rutas como ruta de diseño: lo que cuelga de ella solo se ve con sesión y, si se indican `roles`, con
 * uno de ellos. Sin sesión lleva al ingreso y recuerda a dónde se iba. La API decide igual por su cuenta (ADR-003 y
 * `docs/matriz-de-roles.md`): esto solo evita mostrar pantallas que de todos modos darían 403.
 */
export function RutaProtegida({ roles }: { roles?: readonly Rol[] }) {
  const { estado } = useSesion();
  const ubicacion = useLocation();

  if (estado.tipo === 'cargando') {
    return <output className="estado-carga">Cargando…</output>;
  }
  if (estado.tipo === 'anonimo') {
    return <Navigate to="/ingreso" replace state={{ desde: ubicacion.pathname + ubicacion.search }} />;
  }
  if (roles && !roles.includes(estado.usuario.rol)) return <SinPermiso />;
  return <Outlet />;
}
