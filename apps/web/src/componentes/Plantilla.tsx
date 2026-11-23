import { useEffect, useRef } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import type { Rol } from '../api/auth';
import { useSesion } from '../sesion/contexto';

const ETIQUETA_DE_ROL: Record<Rol, string> = {
  administrador: 'Administrador',
  editor: 'Editor',
  consulta: 'Consulta',
};

/** Marco de las pantallas con sesión: cabecera con el menú según el rol, contenido y pie. */
export function Plantilla() {
  const { estado, salir } = useSesion();
  const usuario = estado.tipo === 'autenticado' ? estado.usuario : null;
  const ubicacion = useLocation();
  const principal = useRef<HTMLElement>(null);
  const primeraVez = useRef(true);

  // Al cambiar de pantalla el foco pasa al contenido: sin esto, con teclado o lector de pantalla el foco se
  // queda en un enlace que ya no existe y la persona no sabe que la página cambió.
  useEffect(() => {
    if (primeraVez.current) {
      primeraVez.current = false;
      return;
    }
    principal.current?.focus();
  }, [ubicacion.pathname]);

  const puedeCargar = usuario?.rol === 'administrador' || usuario?.rol === 'editor';
  const esAdministrador = usuario?.rol === 'administrador';

  return (
    <div className="plantilla">
      <a className="saltar" href="#contenido">
        Saltar al contenido
      </a>
      <header className="cabecera">
        <div className="cabecera__interior">
          <Link to="/documentos" className="marca">
            <span className="marca__nombre">Faro</span>
            <span className="marca__lema">Gestión documental</span>
          </Link>
          <nav aria-label="Principal" className="menu">
            <ul>
              <li>
                <NavLink to="/documentos" end>
                  Documentos
                </NavLink>
              </li>
              {puedeCargar && (
                <li>
                  <NavLink to="/documentos/nuevo">Cargar documento</NavLink>
                </li>
              )}
              {esAdministrador && (
                <>
                  <li>
                    <NavLink to="/usuarios">Usuarios</NavLink>
                  </li>
                  <li>
                    <NavLink to="/auditoria">Auditoría</NavLink>
                  </li>
                </>
              )}
            </ul>
          </nav>
          {usuario && (
            <div className="sesion">
              <p className="sesion__persona">
                <span className="sesion__nombre">{usuario.nombre}</span>
                <span className="sesion__rol">{ETIQUETA_DE_ROL[usuario.rol]}</span>
              </p>
              <button type="button" className="boton boton--secundario" onClick={() => void salir()}>
                Cerrar sesión
              </button>
            </div>
          )}
        </div>
      </header>
      <main id="contenido" className="contenido" tabIndex={-1} ref={principal}>
        <Outlet />
      </main>
      <footer className="pie">Prototipo de clase con datos ficticios · E.I.C.E. Faro del Catatumbo S.A.S.</footer>
    </div>
  );
}
