import { Link } from 'react-router';
import { useTitulo } from '../utilidades/useTitulo';

interface Propiedades {
  titulo: string;
  /** Número del issue donde se construye esta pantalla. */
  issue: number;
  descripcion: string;
}

/** Pantalla provisional de una ruta que ya existe pero cuya pantalla es de otro issue. */
export function Marcador({ titulo, issue, descripcion }: Propiedades) {
  useTitulo(titulo);
  return (
    <section className="marcador" aria-labelledby="titulo-marcador">
      <h1 id="titulo-marcador">{titulo}</h1>
      <p className="aviso aviso--info">
        Esta pantalla se construye en el issue #{issue}. {descripcion}
      </p>
      <p>
        <Link to="/documentos">Volver a los documentos</Link>
      </p>
    </section>
  );
}
