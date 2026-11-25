import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { LIMITES, restaurarVersion, type VersionDetalle } from '../api/documentos';
import { traducirError } from '../api/errores';
import { validarTexto } from '../utilidades/validacion';
import { Campo } from './Campo';

interface Propiedades {
  documentoId: number;
  /** La versión que se quiere restaurar. */
  numero: number;
  /** El número de la versión vigente hoy: la restauración crea la siguiente. */
  vigente: number;
  alRestaurar: (version: VersionDetalle) => void;
  alCancelar: () => void;
}

function esCancelacion(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/**
 * Confirmación de restaurar una versión anterior. Restaurar NO borra ni edita nada: crea una versión nueva con el
 * contenido de la elegida (ADR-005). Por eso se pide una confirmación explícita que lo dice, y un motivo opcional.
 */
export function RestaurarVersion({ documentoId, numero, vigente, alRestaurar, alCancelar }: Propiedades) {
  const [motivo, setMotivo] = useState('');
  const [errorDeMotivo, setErrorDeMotivo] = useState<string | undefined>(undefined);
  const [error, setError] = useState<{ mensaje: string } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const enviandoAhora = useRef(false);
  const control = useRef<AbortController | null>(null);
  const titulo = useRef<HTMLHeadingElement>(null);
  const alerta = useRef<HTMLDivElement>(null);
  const idTitulo = useId();

  // Al abrirse, el foco va al título del panel: quien usa teclado o lector de pantalla sabe dónde está.
  useEffect(() => {
    titulo.current?.focus();
  }, []);
  useEffect(() => {
    if (error) alerta.current?.focus();
  }, [error]);
  useEffect(() => () => control.current?.abort(), []);

  async function confirmar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviandoAhora.current) return;
    const problema = validarTexto(motivo, LIMITES.motivo);
    setErrorDeMotivo(problema);
    if (problema) return;
    enviandoAhora.current = true;
    setEnviando(true);
    setError(null);
    control.current = new AbortController();
    try {
      alRestaurar(await restaurarVersion(documentoId, numero, motivo, control.current.signal));
      return;
    } catch (fallo) {
      if (esCancelacion(fallo)) return;
      setError({ mensaje: traducirError(fallo, 'restauracion').mensaje });
    }
    enviandoAhora.current = false;
    setEnviando(false);
  }

  return (
    <form
      className="restaurar"
      aria-labelledby={idTitulo}
      onSubmit={(evento) => void confirmar(evento)}
      noValidate
      aria-busy={enviando}
    >
      <h4 id={idTitulo} ref={titulo} tabIndex={-1} className="restaurar__titulo">
        ¿Restaurar la versión {numero}?
      </h4>
      <p>
        Se creará una <strong>versión nueva</strong> (la {vigente + 1}) con el mismo contenido que la versión {numero}, y pasará a ser la
        vigente. <strong>No se borra nada</strong>: las versiones que ya existen, incluida la {vigente}, siguen en el historial.
      </p>
      <fieldset className="restaurar__campos" disabled={enviando}>
        <legend className="visualmente-oculto">Motivo de la restauración</legend>
        <Campo
          etiqueta="Motivo de la restauración"
          ayuda={`Si lo dejas vacío se guarda como «Restaura la versión ${numero}».`}
          error={errorDeMotivo}
          contador={{ actual: motivo.length, maximo: LIMITES.motivo }}
        >
          {(propiedades) => (
            <input
              {...propiedades}
              name="motivo"
              type="text"
              autoComplete="off"
              maxLength={LIMITES.motivo}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
          )}
        </Campo>
      </fieldset>
      {error && (
        <div ref={alerta} tabIndex={-1} role="alert" className="aviso aviso--error">
          <p>{error.mensaje}</p>
        </div>
      )}
      <div className="acciones acciones--formulario">
        <button type="submit" className="boton boton--primario" disabled={enviando}>
          {enviando ? 'Restaurando…' : `Sí, restaurar la versión ${numero}`}
        </button>
        <button type="button" className="boton boton--secundario" onClick={alCancelar} disabled={enviando}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
