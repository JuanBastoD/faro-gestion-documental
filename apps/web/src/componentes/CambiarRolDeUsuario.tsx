import { useRef, useState } from 'react';
import type { Rol } from '../api/auth';
import { traducirErrorDeUsuarios } from '../api/errores-administracion';
import { cambiarUsuario, type UsuarioAdministrado } from '../api/usuarios';
import { ETIQUETA_DE_ROL } from '../utilidades/roles';
import { useEnfocarPrimerError } from '../utilidades/useEnfocarPrimerError';
import { ElegirRol } from './ElegirRol';
import { PanelDeConfirmacion } from './PanelDeConfirmacion';

interface Propiedades {
  usuario: UsuarioAdministrado;
  /** Es la cuenta de quien está usando la pantalla. */
  esYo: boolean;
  /** El usuario ya cambiado (lo que respondió la API). Quien llama cierra el panel. */
  alCambiar: (usuario: UsuarioAdministrado) => void;
  alCancelar: () => void;
  alFallar?: (error: unknown) => void;
}

/**
 * Cambiar el rol de un usuario. Rige al instante, aunque la persona tenga la sesión abierta (ADR-003 y ADR-008), por eso se
 * confirma en un panel que lo dice. Si la API lo rechaza (409 `ultimo_administrador`), el panel se queda abierto con el motivo.
 */
export function CambiarRolDeUsuario({ usuario, esYo, alCambiar, alCancelar, alFallar }: Propiedades) {
  const [rol, setRol] = useState<Rol>(usuario.rol);
  const [error, setError] = useState<string | undefined>(undefined);
  const [intento, setIntento] = useState(0);
  const contenedor = useRef<HTMLDivElement>(null);
  useEnfocarPrimerError(contenedor, intento);

  /**
   * Elegir otro rol borra el aviso «ya tiene el rol …»: era sobre la elección anterior y, si se queda, contradice lo que se ve
   * marcado. El foco no se toca (se queda en la opción que la persona acaba de elegir); `intento` tampoco, así que no se vuelve
   * a enfocar nada. El aviso reaparece solo si se intenta confirmar de nuevo con el rol actual.
   */
  function elegirRol(nuevo: Rol) {
    setRol(nuevo);
    setError(undefined);
  }

  function validar(): boolean {
    if (rol !== usuario.rol) {
      setError(undefined);
      return true;
    }
    setError(`${usuario.nombre} ya tiene el rol ${ETIQUETA_DE_ROL[usuario.rol]}. Elige uno distinto o cancela.`);
    setIntento((n) => n + 1);
    return false;
  }

  return (
    <PanelDeConfirmacion
      titulo={`Cambiar el rol de ${usuario.nombre}`}
      textoDeConfirmar="Sí, cambiar el rol"
      textoEnCurso="Cambiando el rol…"
      alConfirmar={async (senal) => alCambiar(await cambiarUsuario(usuario.id, { rol }, senal))}
      alCancelar={alCancelar}
      traducir={(fallo) => traducirErrorDeUsuarios(fallo, 'cambio', { usuario: usuario.usuario }).mensaje}
      alFallar={alFallar}
      validar={validar}
    >
      <p>
        El cambio rige <strong>al instante</strong>, aunque la persona tenga la sesión abierta, y queda en la auditoría.
      </p>
      {esYo && (
        <p>
          <strong>Es tu propia cuenta.</strong> Si dejas de ser administrador, perderás el acceso a esta pantalla en cuanto confirmes.
        </p>
      )}
      <div ref={contenedor}>
        <ElegirRol valor={rol} alCambiar={elegirRol} actual={usuario.rol} error={error} leyenda={`Rol nuevo de ${usuario.nombre}`} />
      </div>
    </PanelDeConfirmacion>
  );
}
