import { Link } from 'react-router';
import { useTitulo } from '../utilidades/useTitulo';

/** Cualquier dirección bajo /app/ que no es una pantalla. Se ve también sin sesión, por eso lleva su propio `main`. */
export function NoEncontrada() {
  useTitulo('Página no encontrada');
  return (
    <main className="contenido contenido--centrado" id="contenido">
      <h1>Esta página no existe</h1>
      <p>La dirección no corresponde a ninguna pantalla de Faro.</p>
      <p>
        <Link to="/documentos">Ir a los documentos</Link>
      </p>
    </main>
  );
}
