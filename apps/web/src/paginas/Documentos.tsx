import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { listarDocumentos } from '../api/documentos';
import { listarSeries, type Serie } from '../api/series';
import { Paginacion, totalDePaginas } from '../componentes/Paginacion';
import { useSesion } from '../sesion/contexto';
import { formatearFecha } from '../utilidades/formato';
import { mensajeDeError } from '../utilidades/mensajes';
import { useCarga } from '../utilidades/useCarga';
import { useTitulo } from '../utilidades/useTitulo';

/** Documentos por página. La API admite hasta 50 y usa 20 si no se indica. */
export const TAMANO_DE_PAGINA = 10;

/** Entero positivo de la URL, o `undefined` si falta o no es un número válido. */
function leerEntero(valor: string | null): number | undefined {
  if (valor === null || !/^\d{1,10}$/.test(valor)) return undefined;
  const numero = Number(valor);
  return numero >= 1 ? numero : undefined;
}

interface Filtros {
  q: string;
  serieId: number | undefined;
  pagina: number;
}

/** Lo que se ve en la URL: solo lo que se aparta del valor por defecto, para que el enlace sea corto y compartible. */
function aParametros({ q, serieId, pagina }: Filtros): URLSearchParams {
  const parametros = new URLSearchParams();
  if (q !== '') parametros.set('q', q);
  if (serieId !== undefined) parametros.set('serieId', String(serieId));
  if (pagina > 1) parametros.set('pagina', String(pagina));
  return parametros;
}

/** Nombre de cada subserie por su id, para mostrar «código · nombre» en vez del solo código que trae el listado. */
function indexarSubseries(series: readonly Serie[]): Map<number, string> {
  const nombres = new Map<number, string>();
  for (const serie of series) {
    for (const subserie of serie.subseries) nombres.set(subserie.id, `${subserie.codigo} · ${subserie.nombre}`);
  }
  return nombres;
}

function resumenDeResultados(total: number, q: string): string {
  const cuantos = total === 0 ? 'Sin resultados' : `${total} ${total === 1 ? 'documento' : 'documentos'}`;
  return q === '' ? cuantos : `${cuantos} para «${q}»`;
}

export function Documentos() {
  useTitulo('Documentos');
  const { estado } = useSesion();
  const puedeCargar =
    estado.tipo === 'autenticado' && (estado.usuario.rol === 'administrador' || estado.usuario.rol === 'editor');

  const [parametros, setParametros] = useSearchParams();
  const q = (parametros.get('q') ?? '').trim();
  const serieId = leerEntero(parametros.get('serieId'));
  const pagina = leerEntero(parametros.get('pagina')) ?? 1;

  // Lo escrito en el campo se aplica al buscar (Enter o botón); mientras tanto vive aquí. Si la URL cambia por otro
  // camino (botón Atrás, un enlace), el campo la sigue: se ajusta durante el render, como indica la documentación de
  // React para estado que depende de otro.
  const [texto, setTexto] = useState(q);
  const [qAplicada, setQAplicada] = useState(q);
  if (q !== qAplicada) {
    setQAplicada(q);
    setTexto(q);
  }

  const [cuadro] = useCarga(useCallback((senal: AbortSignal) => listarSeries(senal), []));
  const series = useMemo(() => (cuadro.tipo === 'listo' ? cuadro.datos : []), [cuadro]);
  const nombresDeSubseries = useMemo(() => indexarSubseries(series), [series]);

  const [carga, reintentar] = useCarga(
    useCallback(
      (senal: AbortSignal) =>
        listarDocumentos({ q: q || undefined, serieId, pagina, tamano: TAMANO_DE_PAGINA }, senal),
      [q, serieId, pagina],
    ),
  );

  // Una página que ya no existe (se editó la URL o desaparecieron resultados): se va a la última que sí.
  useEffect(() => {
    if (carga.tipo === 'listo' && carga.datos.items.length === 0 && carga.datos.total > 0 && pagina > 1) {
      setParametros(aParametros({ q, serieId, pagina: totalDePaginas(carga.datos.total, TAMANO_DE_PAGINA) }), {
        replace: true,
      });
    }
  }, [carga, pagina, q, serieId, setParametros]);

  function buscar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setParametros(aParametros({ q: texto.trim(), serieId, pagina: 1 }));
  }

  function elegirSerie(valor: string) {
    setParametros(aParametros({ q: texto.trim(), serieId: leerEntero(valor), pagina: 1 }));
  }

  function limpiar() {
    setTexto('');
    setParametros(new URLSearchParams());
  }

  const hayFiltros = q !== '' || serieId !== undefined;

  return (
    <section aria-labelledby="titulo-documentos">
      <h1 id="titulo-documentos">Documentos</h1>

      <search aria-label="Buscar documentos">
        <form className="filtros" onSubmit={buscar}>
          <div className="campo campo--crece">
            <label htmlFor="campo-busqueda">Buscar</label>
            <input
              id="campo-busqueda"
              name="q"
              type="search"
              placeholder="Título, expediente o texto del PDF"
              autoComplete="off"
              maxLength={200}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
            />
          </div>
          <div className="campo campo--crece">
            <label htmlFor="campo-serie">Serie</label>
            <select id="campo-serie" name="serieId" value={serieId ?? ''} onChange={(e) => elegirSerie(e.target.value)}>
              <option value="">Todas las series</option>
              {series.map((serie) => (
                <optgroup key={serie.id} label={`${serie.codigo} · ${serie.nombre}`}>
                  <option value={serie.id}>Toda la serie {serie.codigo}</option>
                  {serie.subseries.map((subserie) => (
                    <option key={subserie.id} value={subserie.id}>
                      {subserie.codigo} · {subserie.nombre}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="filtros__acciones">
            <button type="submit" className="boton boton--primario">
              Buscar
            </button>
            {hayFiltros && (
              <button type="button" className="boton boton--secundario" onClick={limpiar}>
                Quitar filtros
              </button>
            )}
          </div>
        </form>
      </search>
      {cuadro.tipo === 'error' && (
        <p className="aviso aviso--info">
          No se pudo cargar el cuadro de clasificación: el filtro por serie no está disponible.
        </p>
      )}

      <div className="resultados" aria-busy={carga.tipo === 'cargando'}>
        {carga.tipo === 'cargando' && <output className="estado-carga">Cargando documentos…</output>}

        {carga.tipo === 'error' && (
          <div role="alert" className="aviso aviso--error">
            <p>{mensajeDeError(carga.error)}</p>
            <button type="button" className="boton boton--secundario" onClick={reintentar}>
              Reintentar
            </button>
          </div>
        )}

        {carga.tipo === 'listo' && (
          <>
            <output className="resultados__total">{resumenDeResultados(carga.datos.total, q)}</output>

            {carga.datos.items.length === 0 ? (
              <div className="vacio">
                {hayFiltros ? (
                  <p>Ningún documento coincide con lo que buscaste. Prueba con otras palabras o quita los filtros.</p>
                ) : (
                  <p>Aún no hay documentos cargados.</p>
                )}
                {!hayFiltros && puedeCargar && (
                  <p>
                    <Link to="/documentos/nuevo">Cargar el primer documento</Link>
                  </p>
                )}
              </div>
            ) : (
              <ul className="lista-documentos">
                {carga.datos.items.map((documento) => (
                  <li key={documento.id} className="tarjeta">
                    <h2 className="tarjeta__titulo">
                      <Link to={`/documentos/${documento.id}`}>{documento.titulo}</Link>
                    </h2>
                    <dl className="datos">
                      <div>
                        <dt>Expediente</dt>
                        <dd>{documento.expediente}</dd>
                      </div>
                      <div>
                        <dt>Serie</dt>
                        <dd>{nombresDeSubseries.get(documento.serieId) ?? documento.serieCodigo}</dd>
                      </div>
                      <div>
                        <dt>Fecha</dt>
                        <dd>{formatearFecha(documento.fechaDocumento)}</dd>
                      </div>
                      <div>
                        <dt>Versión</dt>
                        <dd>{documento.versionActual}</dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ul>
            )}

            <Paginacion
              pagina={carga.datos.pagina}
              tamano={carga.datos.tamano}
              total={carga.datos.total}
              alCambiar={(nueva) => setParametros(aParametros({ q, serieId, pagina: nueva }))}
            />
          </>
        )}
      </div>
    </section>
  );
}
