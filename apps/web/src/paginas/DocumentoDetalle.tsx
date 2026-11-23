import { useCallback, useMemo } from 'react';
import { Link, useParams } from 'react-router';
import { obtenerDocumento, urlDeArchivo } from '../api/documentos';
import { ErrorApi } from '../api/cliente';
import { listarSeries, type Serie } from '../api/series';
import { useSesion } from '../sesion/contexto';
import { formatearFecha, formatearFechaHora, formatearTamano } from '../utilidades/formato';
import { mensajeDeError } from '../utilidades/mensajes';
import { useCarga } from '../utilidades/useCarga';
import { useTitulo } from '../utilidades/useTitulo';

/** El identificador de la URL como número, o `undefined` si no es un entero positivo (no se llama a la API). */
function leerId(valor: string | undefined): number | undefined {
  if (valor === undefined || !/^\d{1,10}$/.test(valor)) return undefined;
  const id = Number(valor);
  return id >= 1 ? id : undefined;
}

/** «código · nombre (serie código · nombre)» de una subserie, o `undefined` si no está en el cuadro. */
function describirSubserie(series: readonly Serie[], subserieId: number): string | undefined {
  for (const padre of series) {
    const subserie = padre.subseries.find((s) => s.id === subserieId);
    if (subserie) return `${subserie.codigo} · ${subserie.nombre} (serie ${padre.codigo} · ${padre.nombre})`;
  }
  return undefined;
}

export function DocumentoDetalle() {
  const { id: idDeLaUrl } = useParams();
  const id = leerId(idDeLaUrl);
  const { estado } = useSesion();
  const puedeVersionar =
    estado.tipo === 'autenticado' && (estado.usuario.rol === 'administrador' || estado.usuario.rol === 'editor');

  const [carga, reintentar] = useCarga(
    useCallback(
      // Un identificador que no es un número no puede existir: se evita la llamada y se trata como no encontrado.
      (senal: AbortSignal) => (id === undefined ? Promise.resolve(null) : obtenerDocumento(id, senal)),
      [id],
    ),
  );
  // El documento trae solo el código de su subserie: el nombre sale del cuadro de clasificación.
  const [cuadro] = useCarga(useCallback((senal: AbortSignal) => listarSeries(senal), []));
  const documento = carga.tipo === 'listo' ? carga.datos : null;
  const serie = useMemo(
    () => (documento && cuadro.tipo === 'listo' ? describirSubserie(cuadro.datos, documento.serieId) : undefined),
    [documento, cuadro],
  );

  const noExiste = (carga.tipo === 'listo' && carga.datos === null) || (carga.tipo === 'error' && carga.error instanceof ErrorApi && carga.error.estado === 404);
  useTitulo(documento ? documento.titulo : 'Documento');

  if (carga.tipo === 'cargando') {
    return <output className="estado-carga">Cargando documento…</output>;
  }

  if (noExiste) {
    return (
      <section aria-labelledby="titulo-no-existe">
        <h1 id="titulo-no-existe">El documento no existe</h1>
        <p>No hay un documento con esa dirección. Puede que se haya escrito mal o que ya no esté disponible.</p>
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

  return (
    <article aria-labelledby="titulo-documento">
      <p className="migas">
        <Link to="/documentos">← Documentos</Link>
      </p>
      <h1 id="titulo-documento">{documento.titulo}</h1>

      <dl className="datos datos--detalle">
        <div>
          <dt>Expediente</dt>
          <dd>{documento.expediente}</dd>
        </div>
        <div>
          <dt>Serie</dt>
          <dd>{serie ?? documento.serieCodigo}</dd>
        </div>
        <div>
          <dt>Fecha del documento</dt>
          <dd>{formatearFecha(documento.fechaDocumento)}</dd>
        </div>
        <div>
          <dt>Cargado</dt>
          <dd>{formatearFechaHora(documento.creadoEn)}</dd>
        </div>
        <div>
          <dt>Versión vigente</dt>
          <dd>{vigente ? vigente.numero : 'Sin versiones'}</dd>
        </div>
      </dl>

      <div className="acciones">
        {vigente && (
          <a className="boton boton--primario" href={urlDeArchivo(documento.id, vigente.numero)} download>
            Descargar la versión vigente (PDF)
          </a>
        )}
        {puedeVersionar && (
          <Link className="boton boton--secundario" to={`/documentos/${documento.id}/version`}>
            Subir una versión nueva
          </Link>
        )}
      </div>

      <section aria-labelledby="titulo-historial" className="historial">
        <h2 id="titulo-historial">Historial de versiones</h2>
        <p className="historial__nota">La más reciente primero. El historial solo crece: nada se edita ni se borra.</p>
        <ol className="lista-versiones">
          {documento.versiones.map((version) => (
            <li key={version.numero} className="tarjeta">
              <div className="tarjeta__cabecera">
                <h3 className="tarjeta__titulo">
                  Versión {version.numero}
                  {version.numero === vigente?.numero && <span className="etiqueta etiqueta--vigente">Vigente</span>}
                  {version.restauradaDe !== null && (
                    <span className="etiqueta">Restaura la versión {version.restauradaDe}</span>
                  )}
                </h3>
                <a
                  className="boton boton--secundario"
                  href={urlDeArchivo(documento.id, version.numero)}
                  download
                  aria-label={`Descargar la versión ${version.numero}`}
                >
                  Descargar
                </a>
              </div>
              <p className="tarjeta__motivo">{version.motivo}</p>
              <dl className="datos">
                <div>
                  <dt>Autor</dt>
                  <dd>{version.autor}</dd>
                </div>
                <div>
                  <dt>Fecha</dt>
                  <dd>{formatearFechaHora(version.creadoEn)}</dd>
                </div>
                <div>
                  <dt>Archivo</dt>
                  <dd>{version.nombreOriginal}</dd>
                </div>
                <div>
                  <dt>Tamaño</dt>
                  <dd>{formatearTamano(version.tamano)}</dd>
                </div>
                <div>
                  <dt>Huella SHA-256</dt>
                  <dd className="huella" title={version.sha256}>
                    {version.sha256.slice(0, 16)}…
                  </dd>
                </div>
              </dl>
              {version.textoEstado === 'sin_texto' && (
                <p className="nota">
                  Sin capa de texto: no se puede buscar por su contenido y solo se verifica por huella exacta.
                </p>
              )}
            </li>
          ))}
        </ol>
      </section>
    </article>
  );
}
