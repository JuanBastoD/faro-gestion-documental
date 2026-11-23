import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ErrorApi } from '../api/cliente';
import { agregarVersion, LIMITES, obtenerDocumento } from '../api/documentos';
import { traducirError, type CampoDeFormulario } from '../api/errores';
import { Campo } from '../componentes/Campo';
import { CampoArchivo } from '../componentes/CampoArchivo';
import { leerId } from '../utilidades/identificadores';
import { mensajeDeError } from '../utilidades/mensajes';
import { useCarga } from '../utilidades/useCarga';
import { useEnfocarPrimerError } from '../utilidades/useEnfocarPrimerError';
import { useTitulo } from '../utilidades/useTitulo';
import { validarArchivo, validarTexto } from '../utilidades/validacion';

type Errores = Partial<Record<CampoDeFormulario, string>>;

function esCancelacion(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/**
 * Subir una versión nueva de un documento (issue #24): el archivo y el motivo del cambio, que es obligatorio. La versión
 * anterior no se toca: el historial solo crece (ADR-005). Si el contenido ya está en una versión del documento, la API
 * responde 409 y se dice cuál es. Al terminar vuelve al detalle, que muestra la versión nueva.
 */
export function NuevaVersion() {
  useTitulo('Subir una versión nueva');
  const { id: idDeLaUrl } = useParams();
  const id = leerId(idDeLaUrl);
  const navegar = useNavigate();

  const [archivo, setArchivo] = useState<File | null>(null);
  const [motivo, setMotivo] = useState('');
  const [errores, setErrores] = useState<Errores>({});
  const [errorGeneral, setErrorGeneral] = useState<{ mensaje: string } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [intento, setIntento] = useState(0);

  const enviandoAhora = useRef(false);
  const control = useRef<AbortController | null>(null);
  const formulario = useRef<HTMLFormElement>(null);
  const alerta = useRef<HTMLDivElement>(null);

  const [carga, reintentar] = useCarga(
    useCallback(
      (senal: AbortSignal) => (id === undefined ? Promise.resolve(null) : obtenerDocumento(id, senal)),
      [id],
    ),
  );
  const documento = carga.tipo === 'listo' ? carga.datos : null;

  useEnfocarPrimerError(formulario, intento);
  useEffect(() => {
    if (errorGeneral) alerta.current?.focus();
  }, [errorGeneral]);
  useEffect(() => () => control.current?.abort(), []);

  const noExiste =
    (carga.tipo === 'listo' && carga.datos === null) ||
    (carga.tipo === 'error' && carga.error instanceof ErrorApi && carga.error.estado === 404);

  if (carga.tipo === 'cargando') {
    return <output className="estado-carga">Cargando documento…</output>;
  }

  if (noExiste) {
    return (
      <section aria-labelledby="titulo-no-existe">
        <h1 id="titulo-no-existe">El documento no existe</h1>
        <p>No hay un documento con esa dirección, así que no se puede subir una versión. Puede que se haya escrito mal o que ya no esté disponible.</p>
        <p>
          <Link to="/documentos">Volver a los documentos</Link>
        </p>
      </section>
    );
  }

  if (carga.tipo === 'error' || documento === null) {
    return (
      <section aria-labelledby="titulo-error-documento">
        <h1 id="titulo-error-documento">No se pudo abrir el documento</h1>
        <div role="alert" className="aviso aviso--error">
          <p>{mensajeDeError(carga.tipo === 'error' ? carga.error : undefined)}</p>
          <button type="button" className="boton boton--secundario" onClick={reintentar}>
            Reintentar
          </button>
        </div>
        <p>
          <Link to="/documentos">Volver a los documentos</Link>
        </p>
      </section>
    );
  }

  const vigente = documento.versiones[0];

  async function enviar(elegido: File, texto: string) {
    if (enviandoAhora.current || documento === null) return;
    enviandoAhora.current = true;
    setEnviando(true);
    setErrorGeneral(null);
    control.current = new AbortController();
    try {
      const version = await agregarVersion(documento.id, elegido, texto, control.current.signal);
      void navegar(`/documentos/${documento.id}`, {
        state: { aviso: `Se agregó la versión ${version.numero} de «${documento.titulo}». Las versiones anteriores siguen en el historial.` },
      });
      return;
    } catch (fallo) {
      if (esCancelacion(fallo)) return;
      const traducido = traducirError(fallo, 'version');
      setErrores(traducido.campos);
      if (Object.keys(traducido.campos).length > 0) setIntento((n) => n + 1);
      setErrorGeneral({ mensaje: traducido.mensaje });
    }
    enviandoAhora.current = false;
    setEnviando(false);
  }

  function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviandoAhora.current) return;
    const nuevos: Errores = {
      archivo: validarArchivo(archivo),
      motivo: validarTexto(motivo, LIMITES.motivo, 'Escribe el motivo: explica qué cambió en esta versión.'),
    };
    const conErrores = Object.fromEntries(Object.entries(nuevos).filter(([, mensaje]) => mensaje !== undefined)) as Errores;
    setErrores(conErrores);
    setErrorGeneral(null);
    if (Object.keys(conErrores).length > 0 || archivo === null) {
      setIntento((n) => n + 1);
      return;
    }
    void enviar(archivo, motivo);
  }

  return (
    <article aria-labelledby="titulo-version" className="pagina-formulario">
      <p className="migas">
        <Link to={`/documentos/${documento.id}`}>← {documento.titulo}</Link>
      </p>
      <h1 id="titulo-version">Subir una versión nueva</h1>
      <p className="introduccion">
        Documento: <strong>{documento.titulo}</strong> (expediente {documento.expediente}).{' '}
        {vigente ? `La versión vigente es la ${vigente.numero}. ` : ''}
        No se borra nada: la versión actual queda en el historial y la que subas pasa a ser la vigente.
      </p>

      <form ref={formulario} onSubmit={alEnviar} noValidate aria-busy={enviando} className="formulario">
        <fieldset className="formulario__interior" disabled={enviando}>
          <legend className="visualmente-oculto">Datos de la versión nueva</legend>

          <CampoArchivo archivo={archivo} error={errores.archivo} alCambiar={setArchivo} />

          <Campo
            etiqueta="Motivo del cambio"
            obligatorio
            ayuda="Explica qué cambió en esta versión, por ejemplo «Se corrigió el valor de la cláusula 4». Queda en el historial."
            error={errores.motivo}
            contador={{ actual: motivo.length, maximo: LIMITES.motivo }}
          >
            {(propiedades) => (
              <textarea
                {...propiedades}
                name="motivo"
                rows={3}
                maxLength={LIMITES.motivo}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
              />
            )}
          </Campo>
        </fieldset>

        {errorGeneral && (
          <div ref={alerta} tabIndex={-1} role="alert" className="aviso aviso--error">
            <p>{errorGeneral.mensaje}</p>
          </div>
        )}

        <div className="acciones acciones--formulario">
          <button type="submit" className="boton boton--primario" disabled={enviando}>
            {enviando ? 'Subiendo la versión…' : 'Subir versión nueva'}
          </button>
          <Link className="boton boton--secundario" to={`/documentos/${documento.id}`}>
            Cancelar
          </Link>
        </div>
      </form>
    </article>
  );
}
