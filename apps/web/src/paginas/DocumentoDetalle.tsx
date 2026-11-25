import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { obtenerDocumento, urlDeArchivo, type VersionDetalle } from '../api/documentos';
import { ErrorApi } from '../api/cliente';
import { listarSeries, type Serie } from '../api/series';
import { RestaurarVersion } from '../componentes/RestaurarVersion';
import { useSesion } from '../sesion/contexto';
import { formatearFecha, formatearFechaHora, formatearTamano } from '../utilidades/formato';
import { leerId } from '../utilidades/identificadores';
import { mensajeDeError } from '../utilidades/mensajes';
import { useCarga } from '../utilidades/useCarga';
import { useTitulo } from '../utilidades/useTitulo';

/** El aviso que dejó la pantalla anterior (`navigate(..., { state: { aviso } })`), si lo hay. */
function leerAviso(estado: unknown): string | null {
  const aviso = typeof estado === 'object' && estado !== null && 'aviso' in estado ? estado.aviso : undefined;
  return typeof aviso === 'string' && aviso !== '' ? aviso : null;
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

  const ubicacion = useLocation();
  const navegar = useNavigate();
  // El aviso («Se agregó la versión 3…») llega por el estado de la navegación. Se copia a un estado propio y se borra de la
  // historia del navegador para que no reaparezca al recargar la página ni al volver atrás.
  const [aviso, setAviso] = useState<string | null>(() => leerAviso(ubicacion.state));
  const avisoLimpiado = useRef(false);
  const rutaActual = ubicacion.pathname + ubicacion.search;
  useEffect(() => {
    if (aviso === null || avisoLimpiado.current) return;
    avisoLimpiado.current = true;
    void navegar(rutaActual, { replace: true, state: null });
  }, [aviso, navegar, rutaActual]);
  const salidaDelAviso = useRef<HTMLOutputElement>(null);
  const [restaurando, setRestaurando] = useState<number | null>(null);

  const [carga, reintentar] = useCarga(
    useCallback(
      // Un identificador que no es un número no puede existir: se evita la llamada y se trata como no encontrado.
      (senal: AbortSignal) => (id === undefined ? Promise.resolve(null) : obtenerDocumento(id, senal)),
      [id],
    ),
  );
  const listo = carga.tipo === 'listo';
  // Al llegar con un aviso (o tras restaurar una versión) el foco va al aviso, para que se note con teclado y lector de pantalla.
  useEffect(() => {
    if (aviso !== null && listo) salidaDelAviso.current?.focus();
  }, [aviso, listo]);

  function alRestaurar(version: VersionDetalle, origen: number) {
    setAviso(`Se creó la versión ${version.numero} con el contenido de la versión ${origen}. Las versiones anteriores siguen en el historial.`);
    setRestaurando(null);
    reintentar();
  }

  function alCancelarRestauracion(numero: number) {
    setRestaurando(null);
    // El panel desaparece: el foco vuelve al botón que lo abrió.
    setTimeout(() => document.getElementById(`boton-restaurar-${numero}`)?.focus(), 0);
  }
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

      {aviso !== null && (
        <output ref={salidaDelAviso} tabIndex={-1} className="aviso aviso--ok aviso--bloque">
          {aviso}
        </output>
      )}

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
                <div className="tarjeta__acciones">
                  <a
                    className="boton boton--secundario"
                    href={urlDeArchivo(documento.id, version.numero)}
                    download
                    aria-label={`Descargar la versión ${version.numero}`}
                  >
                    Descargar
                  </a>
                  {puedeVersionar && version.numero !== vigente?.numero && restaurando !== version.numero && (
                    <button
                      type="button"
                      id={`boton-restaurar-${version.numero}`}
                      className="boton boton--secundario"
                      aria-label={`Restaurar la versión ${version.numero}`}
                      onClick={() => setRestaurando(version.numero)}
                    >
                      Restaurar
                    </button>
                  )}
                </div>
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
              {puedeVersionar && vigente && restaurando === version.numero && (
                <RestaurarVersion
                  documentoId={documento.id}
                  numero={version.numero}
                  vigente={vigente.numero}
                  alRestaurar={(creada) => alRestaurar(creada, version.numero)}
                  alCancelar={() => alCancelarRestauracion(version.numero)}
                />
              )}
            </li>
          ))}
        </ol>
      </section>
    </article>
  );
}
