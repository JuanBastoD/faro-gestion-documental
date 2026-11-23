import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';

interface Propiedades {
  titulo: string;
  textoDeConfirmar: string;
  textoEnCurso: string;
  /** Pinta el botón de confirmar como una acción con consecuencias (desactivar). */
  peligro?: boolean;
  /**
   * Hace el cambio. Si la API lo rechaza, lanza el error y el panel lo muestra (con `traducir`) sin cerrarse. Si termina bien,
   * quien llama debe cerrar el panel: el panel no vuelve a habilitar el botón después de un éxito.
   */
  alConfirmar: (senal: AbortSignal) => Promise<void>;
  alCancelar: () => void;
  /** El texto de la alerta para un error de `alConfirmar`. */
  traducir: (error: unknown) => string;
  /** Se llama con el error crudo, para que quien llama reaccione (volver a leer la sesión ante un 403, por ejemplo). */
  alFallar?: (error: unknown) => void;
  /** Una comprobación antes de enviar: si devuelve `false` no se envía (quien la hace muestra su propio error). */
  validar?: () => boolean;
  children: ReactNode;
}

function esCancelacion(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/**
 * Confirmación en el mismo lugar (no un cuadro modal) para una acción sobre un usuario: explica qué pasará, deja elegir lo que
 * haga falta (`children`) y pide confirmar. Mismo patrón que restaurar una versión (#24): el foco va al título al abrirse, un
 * error pone el foco en la alerta, un segundo envío se ignora y salir de la pantalla cancela la petición en curso.
 */
export function PanelDeConfirmacion({
  titulo,
  textoDeConfirmar,
  textoEnCurso,
  peligro = false,
  alConfirmar,
  alCancelar,
  traducir,
  alFallar,
  validar,
  children,
}: Propiedades) {
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const enviandoAhora = useRef(false);
  const control = useRef<AbortController | null>(null);
  const encabezado = useRef<HTMLHeadingElement>(null);
  const alerta = useRef<HTMLDivElement>(null);
  const idTitulo = useId();

  useEffect(() => {
    encabezado.current?.focus();
  }, []);
  useEffect(() => {
    if (error) alerta.current?.focus();
  }, [error]);
  useEffect(() => () => control.current?.abort(), []);

  async function confirmar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviandoAhora.current) return;
    if (validar && !validar()) return;
    enviandoAhora.current = true;
    setEnviando(true);
    setError(null);
    control.current = new AbortController();
    try {
      await alConfirmar(control.current.signal);
      return;
    } catch (fallo) {
      if (esCancelacion(fallo)) return;
      setError(traducir(fallo));
      alFallar?.(fallo);
    }
    enviandoAhora.current = false;
    setEnviando(false);
  }

  return (
    <form className="restaurar" aria-labelledby={idTitulo} onSubmit={(e) => void confirmar(e)} noValidate aria-busy={enviando}>
      <h3 id={idTitulo} ref={encabezado} tabIndex={-1} className="restaurar__titulo">
        {titulo}
      </h3>
      <fieldset className="restaurar__campos" disabled={enviando}>
        <legend className="visualmente-oculto">{titulo}</legend>
        {children}
      </fieldset>
      {error && (
        <div ref={alerta} tabIndex={-1} role="alert" className="aviso aviso--error">
          <p>{error}</p>
        </div>
      )}
      <div className="acciones acciones--formulario">
        <button type="submit" className={peligro ? 'boton boton--peligro' : 'boton boton--primario'} disabled={enviando}>
          {enviando ? textoEnCurso : textoDeConfirmar}
        </button>
        <button type="button" className="boton boton--secundario" onClick={alCancelar} disabled={enviando}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
