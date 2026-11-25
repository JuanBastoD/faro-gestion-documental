import { useId, useRef, useState } from 'react';
import { traducirErrorDeClave } from '../api/errores-clave';
import { LIMITES_DE_USUARIO, restablecerClave, type UsuarioAdministrado } from '../api/usuarios';
import { generarClaveTemporal } from '../utilidades/clave';
import { useEnfocarPrimerError } from '../utilidades/useEnfocarPrimerError';
import { validarClaveTemporal } from '../utilidades/validacion';
import { Campo } from './Campo';
import { PanelDeConfirmacion } from './PanelDeConfirmacion';

interface Propiedades {
  usuario: UsuarioAdministrado;
  /**
   * La API ya fijó la clave. Se entrega aquí, y solo aquí, para que quien llama la muestre una sola vez: la API no la guarda en
   * ningún lado donde se pueda volver a leer. Quien llama cierra el panel.
   */
  alRestablecer: (usuario: UsuarioAdministrado, clave: string) => void;
  alCancelar: () => void;
  alFallar?: (error: unknown) => void;
}

/**
 * Restablecer la clave de otra persona (issue #51, solo administrador, nunca la propia). El administrador escribe una clave
 * temporal (12 a 256 caracteres) o la genera aquí con `crypto.getRandomValues` [PROPUESTA]. Al confirmar, la API cierra todas las
 * sesiones de esa persona y le exige cambiarla al ingresar. La clave se muestra una sola vez después (`ClaveTemporal`); este
 * panel no la guarda en ningún lado: vive en el estado del formulario hasta que se confirma o se cancela.
 */
export function RestablecerClave({ usuario, alRestablecer, alCancelar, alFallar }: Propiedades) {
  const [clave, setClave] = useState('');
  const [verClave, setVerClave] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [intento, setIntento] = useState(0);
  const contenedor = useRef<HTMLDivElement>(null);
  const idVerClave = useId();
  useEnfocarPrimerError(contenedor, intento);

  function validar(): boolean {
    const problema = validarClaveTemporal(clave);
    setError(problema);
    if (problema) setIntento((n) => n + 1);
    return problema === undefined;
  }

  function generar() {
    setClave(generarClaveTemporal());
    setVerClave(true);
    setError(undefined);
  }

  return (
    <PanelDeConfirmacion
      titulo={`Restablecer la clave de ${usuario.nombre}`}
      textoDeConfirmar="Sí, restablecer la clave"
      textoEnCurso="Restableciendo…"
      peligro
      validar={validar}
      alConfirmar={async (senal) => {
        await restablecerClave(usuario.id, clave, senal);
        alRestablecer(usuario, clave);
      }}
      alCancelar={alCancelar}
      traducir={(fallo) => traducirErrorDeClave(fallo, 'restablecer', { nombre: usuario.nombre }).mensaje}
      alFallar={alFallar}
    >
      <p>
        {usuario.nombre} <strong>no podrá ingresar con su clave actual</strong> y sus sesiones abiertas se cierran{' '}
        <strong>al instante</strong>. Con la clave temporal que fijes aquí, el sistema le pedirá elegir una propia antes de dejarle
        hacer cualquier otra cosa. Queda en la auditoría.
      </p>
      <p>
        El sistema <strong>no vuelve a mostrar</strong> la clave: al terminar la verás una sola vez, para que la copies y se la entregues
        por otro medio (en persona o por una llamada), no en el mismo mensaje donde le dices su usuario.
      </p>
      <div ref={contenedor}>
        <Campo
          etiqueta="Clave temporal"
          obligatorio
          ayuda={`De ${LIMITES_DE_USUARIO.claveMinima} a ${LIMITES_DE_USUARIO.claveMaxima} caracteres. Escríbela tú o genera una: si la generas, queda a la vista para que la anotes.`}
          error={error}
        >
          {(propiedades) => (
            <input
              {...propiedades}
              name="claveTemporal"
              type={verClave ? 'text' : 'password'}
              autoComplete="new-password"
              autoCapitalize="none"
              spellCheck={false}
              value={clave}
              onChange={(e) => setClave(e.target.value)}
            />
          )}
        </Campo>
        <div className="clave-acciones">
          <button type="button" className="boton boton--secundario" onClick={generar}>
            Generar una clave
          </button>
          <div className="campo-verclave">
            <input id={idVerClave} type="checkbox" checked={verClave} onChange={(e) => setVerClave(e.target.checked)} />
            <label htmlFor={idVerClave}>Mostrar la clave mientras la escribo</label>
          </div>
        </div>
      </div>
    </PanelDeConfirmacion>
  );
}
