import { Navigate, Outlet, useLocation } from 'react-router';
import type { Rol } from '../api/auth';
import { SinPermiso } from '../paginas/SinPermiso';
import { useSesion } from './contexto';
import { RUTA_DE_CAMBIO_DE_CLAVE } from './rutas';

/**
 * Guarda de rutas como ruta de diseño: lo que cuelga de ella solo se ve con sesión y, si se indican `roles`, con
 * uno de ellos. Sin sesión lleva al ingreso y recuerda a dónde se iba. Con clave temporal (`debeCambiarClave`) lleva a
 * `/clave` y recuerda a dónde se iba. La API decide igual por su cuenta (ADR-003 y
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
  // Con clave temporal (#57) la API solo deja cambiarla: todo lo demás lleva a esa pantalla, antes incluso de mirar el rol.
  if (estado.usuario.debeCambiarClave === true && ubicacion.pathname !== RUTA_DE_CAMBIO_DE_CLAVE) {
    return <Navigate to={RUTA_DE_CAMBIO_DE_CLAVE} replace state={{ desde: ubicacion.pathname + ubicacion.search }} />;
  }
  if (roles && !roles.includes(estado.usuario.rol)) return <SinPermiso />;
  return <Outlet />;
}
