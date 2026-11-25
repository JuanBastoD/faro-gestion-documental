import { Link } from 'react-router';
import { useTitulo } from '../utilidades/useTitulo';

/** Se muestra cuando la persona abre una ruta que su rol no admite (la API respondería 403). */
export function SinPermiso() {
  useTitulo('Sin permiso');
  return (
    <section aria-labelledby="titulo-sin-permiso">
      <h1 id="titulo-sin-permiso">No tienes permiso para ver esta pantalla</h1>
      <p>Tu rol no incluye esta función. Si la necesitas, pídesela a quien administra el sistema.</p>
      <p>
        <Link to="/documentos">Volver a los documentos</Link>
      </p>
    </section>
  );
}
