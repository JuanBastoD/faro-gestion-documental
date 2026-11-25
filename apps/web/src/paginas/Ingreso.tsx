import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useSesion } from '../sesion/contexto';
import { destinoSeguro } from '../utilidades/destino';
import { mensajeDeError } from '../utilidades/mensajes';
import { useTitulo } from '../utilidades/useTitulo';

export function Ingreso() {
  useTitulo('Ingreso');
  const { estado, ingresar } = useSesion();
  const ubicacion = useLocation();
  const [usuario, setUsuario] = useState('');
  const [clave, setClave] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (estado.tipo === 'autenticado') return <Navigate to={destinoSeguro(ubicacion.state)} replace />;

  async function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviando) return;
    setEnviando(true);
    setError(null);
    try {
      await ingresar(usuario.trim(), clave);
      // Al cambiar la sesión, este componente se reemplaza por <Navigate>: no hay nada más que hacer aquí.
    } catch (fallo) {
      setError(mensajeDeError(fallo));
      setClave('');
      setEnviando(false);
    }
  }

  return (
    <main className="ingreso" id="contenido">
      <section className="ingreso__tarjeta" aria-labelledby="titulo-ingreso">
        <p className="ingreso__marca">Faro</p>
        <h1 id="titulo-ingreso">Ingreso</h1>
        <p className="ingreso__lema">Gestión documental de la E.I.C.E. Faro del Catatumbo S.A.S.</p>

        {estado.tipo === 'anonimo' && estado.expirada && (
          <output className="aviso aviso--info">Tu sesión terminó. Ingresa de nuevo para continuar.</output>
        )}

        <form onSubmit={(e) => void alEnviar(e)} noValidate>
          <div className="campo">
            <label htmlFor="campo-usuario">Usuario</label>
            <input
              id="campo-usuario"
              name="usuario"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
              aria-describedby={error ? 'error-ingreso' : undefined}
            />
          </div>
          <div className="campo">
            <label htmlFor="campo-clave">Clave</label>
            <input
              id="campo-clave"
              name="clave"
              type="password"
              autoComplete="current-password"
              required
              value={clave}
              onChange={(e) => setClave(e.target.value)}
              aria-describedby={error ? 'error-ingreso' : undefined}
            />
          </div>
          {error && (
            <p id="error-ingreso" role="alert" className="aviso aviso--error">
              {error}
            </p>
          )}
          <button type="submit" className="boton boton--primario boton--ancho" disabled={enviando || usuario.trim() === '' || clave === ''}>
            {enviando ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>
        <p className="ingreso__nota">Prototipo de clase: solo datos ficticios.</p>
      </section>
    </main>
  );
}
