import { traducirErrorDeUsuarios } from '../api/errores-administracion';
import { cambiarUsuario, type UsuarioAdministrado } from '../api/usuarios';
import { PanelDeConfirmacion } from './PanelDeConfirmacion';

interface Propiedades {
  usuario: UsuarioAdministrado;
  /** Es la cuenta de quien está usando la pantalla. */
  esYo: boolean;
  /** El usuario ya desactivado (lo que respondió la API). Quien llama cierra el panel. */
  alDesactivar: (usuario: UsuarioAdministrado) => void;
  alCancelar: () => void;
  alFallar?: (error: unknown) => void;
}

/**
 * Desactivar un usuario: no ingresa y sus sesiones se cierran al instante, pero no se borra nada (ADR-008). Por ser de efecto
 * inmediato se confirma en un panel que lo explica; desactivarse a uno mismo lo advierte con más fuerza, porque la sesión de
 * quien confirma es una de las que se cierran. El último administrador activo no se puede desactivar (409).
 */
export function DesactivarUsuario({ usuario, esYo, alDesactivar, alCancelar, alFallar }: Propiedades) {
  return (
    <PanelDeConfirmacion
      titulo={`¿Desactivar a ${usuario.nombre}?`}
      textoDeConfirmar="Sí, desactivar"
      textoEnCurso="Desactivando…"
      peligro
      alConfirmar={async (senal) => alDesactivar(await cambiarUsuario(usuario.id, { activo: false }, senal))}
      alCancelar={alCancelar}
      traducir={(fallo) => traducirErrorDeUsuarios(fallo, 'cambio', { usuario: usuario.usuario }).mensaje}
      alFallar={alFallar}
    >
      <p>
        La persona <strong>no podrá ingresar</strong> y sus sesiones abiertas se cierran <strong>al instante</strong>. No se borra
        nada: lo que cargó y su historial siguen a su nombre, y puedes reactivarla cuando quieras. Queda en la auditoría.
      </p>
      {esYo && (
        <p>
          <strong>Es tu propia cuenta.</strong> Tu sesión se cerrará ahora mismo y no podrás volver a ingresar hasta que otro
          administrador te reactive.
        </p>
      )}
    </PanelDeConfirmacion>
  );
}
