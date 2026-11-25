import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router';
import { cambiarClave } from '../api/auth';
import { traducirErrorDeClave } from '../api/errores-clave';
import { LIMITES_DE_USUARIO } from '../api/usuarios';
import { Campo } from '../componentes/Campo';
import { useSesion } from '../sesion/contexto';
import { destinoSeguro } from '../utilidades/destino';
import { useEnfocarPrimerError } from '../utilidades/useEnfocarPrimerError';
import { useTitulo } from '../utilidades/useTitulo';
import { validarClaveActual, validarClaveNueva, validarRepeticionDeClave } from '../utilidades/validacion';

type Campos = 'claveActual' | 'claveNueva' | 'repeticion';
type Errores = Partial<Record<Campos, string>>;

function esCancelacion(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/**
 * Cambiar la propia clave (issue #51). Es obligatoria mientras la clave sea temporal (la restableció un administrador: la API
 * solo deja hacer esto y la guarda de rutas trae a quien sea hasta aquí) y voluntaria desde el menú, «Mi clave». Se pide la clave
 * actual, la nueva y su repetición. La clave actual equivocada es un error del campo (400 `clave_actual_incorrecta`), nunca una
 * sesión vencida. Las claves no se guardan en ninguna parte ni se muestran en los mensajes, y se borran al terminar.
 */
export function CambiarClave() {
  useTitulo('Cambiar mi clave');
  const { estado, claveCambiada } = useSesion();
  const ubicacion = useLocation();
  const obligatoria = estado.tipo === 'autenticado' && estado.usuario.debeCambiarClave === true;
  const destino = destinoSeguro(ubicacion.state);

  const [claveActual, setClaveActual] = useState('');
  const [claveNueva, setClaveNueva] = useState('');
  const [repeticion, setRepeticion] = useState('');
  const [verClaves, setVerClaves] = useState(false);
  const [errores, setErrores] = useState<Errores>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [intento, setIntento] = useState(0);
  /** Se cambió la clave en esta visita: se muestra el aviso en lugar del formulario. */
  const [hecho, setHecho] = useState<{ eraObligatoria: boolean } | null>(null);

  const enviandoAhora = useRef(false);
  const control = useRef<AbortController | null>(null);
  const formulario = useRef<HTMLFormElement>(null);
  const alerta = useRef<HTMLDivElement>(null);
  const salidaDelAviso = useRef<HTMLOutputElement>(null);
  const idVerClaves = useId();

  useEnfocarPrimerError(formulario, intento);
  useEffect(() => {
    if (errorGeneral) alerta.current?.focus();
  }, [errorGeneral]);
  useEffect(() => {
    if (hecho) salidaDelAviso.current?.focus();
  }, [hecho]);
  useEffect(() => () => control.current?.abort(), []);

  async function enviar() {
    if (enviandoAhora.current) return;
    enviandoAhora.current = true;
    setEnviando(true);
    setErrorGeneral(null);
    control.current = new AbortController();
    try {
      await cambiarClave({ claveActual, claveNueva }, control.current.signal);
      // La API ya no exige el cambio: se anota en la sesión y se borran las claves del estado.
      claveCambiada();
      setClaveActual('');
      setClaveNueva('');
      setRepeticion('');
      setVerClaves(false);
      setErrores({});
      setHecho({ eraObligatoria: obligatoria });
      return;
    } catch (fallo) {
      if (esCancelacion(fallo)) return;
      const traducido = traducirErrorDeClave(fallo, 'cambiar');
      const campos: Errores = {};
      if (traducido.campos.claveActual) campos.claveActual = traducido.campos.claveActual;
      if (traducido.campos.claveNueva) campos.claveNueva = traducido.campos.claveNueva;
      setErrores(campos);
      if (Object.keys(campos).length > 0) {
        // Con el error en su campo no se repite arriba; el foco va al campo.
        setIntento((n) => n + 1);
      } else {
        setErrorGeneral(traducido.mensaje);
      }
    }
    enviandoAhora.current = false;
    setEnviando(false);
  }

  function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviandoAhora.current) return;
    const nuevos: Errores = {
      claveActual: validarClaveActual(claveActual),
      claveNueva: validarClaveNueva(claveNueva, claveActual),
      repeticion: validarRepeticionDeClave(claveNueva, repeticion),
    };
    const conErrores = Object.fromEntries(Object.entries(nuevos).filter(([, mensaje]) => mensaje !== undefined)) as Errores;
    setErrores(conErrores);
    setErrorGeneral(null);
    if (Object.keys(conErrores).length > 0) {
      setIntento((n) => n + 1);
      return;
    }
    void enviar();
  }

  const tipo = verClaves ? 'text' : 'password';

  return (
    <article aria-labelledby="titulo-clave" className="pagina-formulario">
      <h1 id="titulo-clave">Cambiar mi clave</h1>

      {hecho ? (
        <>
          <output ref={salidaDelAviso} tabIndex={-1} className="aviso aviso--ok aviso--bloque">
            Tu clave cambió. Las demás sesiones abiertas con tu usuario se cerraron; esta sigue abierta.
          </output>
          <div className="acciones">
            <Link to={destino} className="boton boton--primario">
              {hecho.eraObligatoria ? 'Continuar' : 'Volver'}
            </Link>
          </div>
        </>
      ) : (
        <>
          {obligatoria ? (
            <p className="aviso aviso--info aviso--bloque">
              <strong>Tu clave es temporal.</strong> Un administrador la restableció. Antes de seguir tienes que elegir una clave
              propia: mientras no lo hagas, el sistema no te deja abrir nada más.
            </p>
          ) : (
            <p className="introduccion">
              Elige una clave nueva. Para hacerlo tienes que escribir primero la que usas hoy. Al cambiarla, las demás sesiones abiertas
              con tu usuario (en otros equipos o navegadores) se cierran; esta sigue abierta.
            </p>
          )}

          <form ref={formulario} className="formulario" onSubmit={alEnviar} noValidate aria-busy={enviando}>
            <fieldset className="formulario__interior" disabled={enviando}>
              <legend className="visualmente-oculto">Datos para cambiar la clave</legend>

              <Campo
                etiqueta="Clave actual"
                obligatorio
                ayuda={obligatoria ? 'La clave temporal que te entregó el administrador.' : 'La que usas hoy para ingresar.'}
                error={errores.claveActual}
              >
                {(propiedades) => (
                  <input
                    {...propiedades}
                    name="claveActual"
                    type={tipo}
                    autoComplete="current-password"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={claveActual}
                    onChange={(e) => setClaveActual(e.target.value)}
                  />
                )}
              </Campo>

              <Campo
                etiqueta="Clave nueva"
                obligatorio
                ayuda={`De ${LIMITES_DE_USUARIO.claveMinima} a ${LIMITES_DE_USUARIO.claveMaxima} caracteres y distinta de la actual.`}
                error={errores.claveNueva}
              >
                {(propiedades) => (
                  <input
                    {...propiedades}
                    name="claveNueva"
                    type={tipo}
                    autoComplete="new-password"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={claveNueva}
                    onChange={(e) => setClaveNueva(e.target.value)}
                  />
                )}
              </Campo>

              <Campo etiqueta="Repite la clave nueva" obligatorio error={errores.repeticion}>
                {(propiedades) => (
                  <input
                    {...propiedades}
                    name="repeticion"
                    type={tipo}
                    autoComplete="new-password"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={repeticion}
                    onChange={(e) => setRepeticion(e.target.value)}
                  />
                )}
              </Campo>

              <div className="campo-verclave">
                <input id={idVerClaves} type="checkbox" checked={verClaves} onChange={(e) => setVerClaves(e.target.checked)} />
                <label htmlFor={idVerClaves}>Mostrar las claves mientras las escribo</label>
              </div>
            </fieldset>

            {errorGeneral && (
              <div ref={alerta} tabIndex={-1} role="alert" className="aviso aviso--error">
                <p>{errorGeneral}</p>
              </div>
            )}

            <div className="acciones acciones--formulario">
              <button type="submit" className="boton boton--primario" disabled={enviando}>
                {enviando ? 'Cambiando la clave…' : 'Cambiar mi clave'}
              </button>
            </div>
          </form>
        </>
      )}
    </article>
  );
}
