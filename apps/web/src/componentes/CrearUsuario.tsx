import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { Rol } from '../api/auth';
import { traducirErrorDeUsuarios, type CampoDeAlta } from '../api/errores-administracion';
import { crearUsuario, LIMITES_DE_USUARIO, type UsuarioAdministrado } from '../api/usuarios';
import { useEnfocarPrimerError } from '../utilidades/useEnfocarPrimerError';
import { validarClaveInicial, validarNombreDeUsuario, validarTexto } from '../utilidades/validacion';
import { Campo } from './Campo';
import { ElegirRol } from './ElegirRol';

type Errores = Partial<Record<CampoDeAlta, string>>;

interface Propiedades {
  /** El usuario ya creado (lo que respondió la API, sin la clave). Quien llama cierra el formulario. */
  alCrear: (usuario: UsuarioAdministrado) => void;
  alCancelar: () => void;
  /** Se llama con el 403 de rol, para volver a leer la sesión. */
  alPerderElRol?: () => void;
}

function esCancelacion(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/**
 * Formulario de alta de usuario. La clave inicial la escribe el administrador (ADR-008, ADR-012 sección 7): se valida aquí como
 * en la API (12 a 256 caracteres), puede mostrarse mientras se escribe para no equivocarse sin verla, y no se guarda en ninguna
 * parte: ni en el estado después de crear, ni en la URL, ni en el historial. El rol que viene marcado es el de menos permisos.
 */
export function CrearUsuario({ alCrear, alCancelar, alPerderElRol }: Propiedades) {
  const [nombre, setNombre] = useState('');
  const [usuario, setUsuario] = useState('');
  const [rol, setRol] = useState<Rol>('consulta');
  const [clave, setClave] = useState('');
  const [verClave, setVerClave] = useState(false);
  const [errores, setErrores] = useState<Errores>({});
  const [errorGeneral, setErrorGeneral] = useState<{ mensaje: string; enfocar: boolean } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [intento, setIntento] = useState(0);

  const enviandoAhora = useRef(false);
  const control = useRef<AbortController | null>(null);
  const formulario = useRef<HTMLFormElement>(null);
  const encabezado = useRef<HTMLHeadingElement>(null);
  const alerta = useRef<HTMLDivElement>(null);
  const idTitulo = useId();
  const idVerClave = useId();

  useEffect(() => {
    encabezado.current?.focus();
  }, []);
  useEnfocarPrimerError(formulario, intento);
  useEffect(() => {
    if (errorGeneral?.enfocar) alerta.current?.focus();
  }, [errorGeneral]);
  useEffect(() => () => control.current?.abort(), []);

  async function enviar() {
    if (enviandoAhora.current) return;
    enviandoAhora.current = true;
    setEnviando(true);
    setErrorGeneral(null);
    control.current = new AbortController();
    const nombreDeUsuario = usuario.trim();
    try {
      const creado = await crearUsuario({ usuario: nombreDeUsuario, nombre: nombre.trim(), rol, clave }, control.current.signal);
      alCrear(creado);
      return;
    } catch (fallo) {
      if (esCancelacion(fallo)) return;
      const traducido = traducirErrorDeUsuarios(fallo, 'alta', { usuario: nombreDeUsuario });
      setErrores(traducido.campos);
      if (Object.keys(traducido.campos).length > 0) setIntento((n) => n + 1);
      setErrorGeneral({ mensaje: traducido.mensaje, enfocar: Object.keys(traducido.campos).length === 0 });
      if (traducido.rolDesactualizado) alPerderElRol?.();
    }
    enviandoAhora.current = false;
    setEnviando(false);
  }

  function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviandoAhora.current) return;
    const nuevos: Errores = {
      nombre: validarTexto(nombre, LIMITES_DE_USUARIO.nombre, 'Escribe el nombre completo de la persona.'),
      usuario: validarNombreDeUsuario(usuario),
      clave: validarClaveInicial(clave),
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

  return (
    <form
      ref={formulario}
      className="formulario formulario--panel"
      aria-labelledby={idTitulo}
      onSubmit={alEnviar}
      noValidate
      aria-busy={enviando}
    >
      <h2 id={idTitulo} ref={encabezado} tabIndex={-1}>
        Crear un usuario
      </h2>
      <p className="introduccion">
        La persona ingresará con el nombre de usuario y la clave inicial que escribas aquí. Los usuarios no se borran: si alguien deja
        de usar el sistema, se desactiva y así se conserva quién cargó cada documento.
      </p>
      <fieldset className="formulario__interior" disabled={enviando}>
        <legend className="visualmente-oculto">Datos del usuario nuevo</legend>

        <Campo
          etiqueta="Nombre completo"
          obligatorio
          ayuda="Como se mostrará en el sistema, por ejemplo «Ana Demo»."
          error={errores.nombre}
          contador={{ actual: nombre.length, maximo: LIMITES_DE_USUARIO.nombre }}
        >
          {(propiedades) => (
            <input
              {...propiedades}
              name="nombre"
              type="text"
              autoComplete="off"
              maxLength={LIMITES_DE_USUARIO.nombre}
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
            />
          )}
        </Campo>

        <Campo
          etiqueta="Nombre de usuario"
          obligatorio
          ayuda="Con él ingresa. De 3 a 64 caracteres: minúsculas sin tilde, números, punto, guion y guion bajo. No se puede cambiar después."
          error={errores.usuario}
        >
          {(propiedades) => (
            <input
              {...propiedades}
              name="usuario"
              type="text"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
            />
          )}
        </Campo>

        <ElegirRol valor={rol} alCambiar={setRol} error={errores.rol} />

        <Campo
          etiqueta="Clave inicial"
          obligatorio
          ayuda={`De ${LIMITES_DE_USUARIO.claveMinima} a ${LIMITES_DE_USUARIO.claveMaxima} caracteres. Escríbela tú y entrégasela a la persona por otro medio, no en el mismo mensaje donde le das su usuario. El sistema no vuelve a mostrarla.`}
          error={errores.clave}
        >
          {(propiedades) => (
            <input
              {...propiedades}
              name="clave"
              type={verClave ? 'text' : 'password'}
              autoComplete="new-password"
              autoCapitalize="none"
              spellCheck={false}
              value={clave}
              onChange={(e) => setClave(e.target.value)}
            />
          )}
        </Campo>
        <div className="campo-verclave">
          <input id={idVerClave} type="checkbox" checked={verClave} onChange={(e) => setVerClave(e.target.checked)} />
          <label htmlFor={idVerClave}>Mostrar la clave mientras la escribo</label>
        </div>
      </fieldset>

      {errorGeneral && (
        <div ref={alerta} tabIndex={-1} role="alert" className="aviso aviso--error">
          <p>{errorGeneral.mensaje}</p>
        </div>
      )}

      <div className="acciones acciones--formulario">
        <button type="submit" className="boton boton--primario" disabled={enviando}>
          {enviando ? 'Creando el usuario…' : 'Crear usuario'}
        </button>
        <button type="button" className="boton boton--secundario" onClick={alCancelar} disabled={enviando}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
