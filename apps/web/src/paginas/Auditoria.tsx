import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { consultarAuditoria } from '../api/auditoria';
import { traducirErrorDeAuditoria } from '../api/errores-administracion';
import { ErrorApi } from '../api/cliente';
import { listarUsuarios } from '../api/usuarios';
import { Campo } from '../componentes/Campo';
import { Paginacion, totalDePaginas } from '../componentes/Paginacion';
import { useSesion } from '../sesion/contexto';
import { ACCIONES_FILTRABLES, etiquetaDeAccion, finDelDia, inicioDelDia } from '../utilidades/auditoria';
import { formatearMomento } from '../utilidades/formato';
import { useCarga } from '../utilidades/useCarga';
import { useEnfocarPrimerError } from '../utilidades/useEnfocarPrimerError';
import { useTitulo } from '../utilidades/useTitulo';
import {
  ANIO_MINIMO,
  validarFechaDeFiltro,
  validarNumeroDeDocumento,
  validarOrdenDeFechas,
} from '../utilidades/validacion';

/** Eventos por página. La API admite hasta 100 y usa 20 si no se indica. */
export const TAMANO_DE_PAGINA = 20;

/** Entero positivo de la URL, o `undefined` si falta o no es un número válido. */
function leerEntero(valor: string | null): number | undefined {
  if (valor === null || !/^\d{1,10}$/.test(valor)) return undefined;
  const numero = Number(valor);
  return numero >= 1 ? numero : undefined;
}

/** Fecha `AAAA-MM-DD` real de la URL, o `undefined`: lo que no sirve se descarta en vez de mandarlo a la API para un 400. */
function leerFecha(valor: string | null): string | undefined {
  return valor !== null && valor !== '' && validarFechaDeFiltro(valor) === undefined ? valor : undefined;
}

interface Filtros {
  usuarioId: number | undefined;
  accion: string | undefined;
  documentoId: number | undefined;
  desde: string | undefined;
  hasta: string | undefined;
  pagina: number;
}

function leerFiltros(parametros: URLSearchParams): Filtros {
  const accion = parametros.get('accion') ?? '';
  return {
    usuarioId: leerEntero(parametros.get('usuarioId')),
    accion: ACCIONES_FILTRABLES.includes(accion) ? accion : undefined,
    documentoId: leerEntero(parametros.get('documentoId')),
    desde: leerFecha(parametros.get('desde')),
    hasta: leerFecha(parametros.get('hasta')),
    pagina: leerEntero(parametros.get('pagina')) ?? 1,
  };
}

/** Lo que se ve en la URL: solo lo que se aparta del valor por defecto, para que el enlace sea corto y se pueda compartir. */
function aParametros({ usuarioId, accion, documentoId, desde, hasta, pagina }: Filtros): URLSearchParams {
  const parametros = new URLSearchParams();
  if (usuarioId !== undefined) parametros.set('usuarioId', String(usuarioId));
  if (accion !== undefined) parametros.set('accion', accion);
  if (documentoId !== undefined) parametros.set('documentoId', String(documentoId));
  if (desde !== undefined) parametros.set('desde', desde);
  if (hasta !== undefined) parametros.set('hasta', hasta);
  if (pagina > 1) parametros.set('pagina', String(pagina));
  return parametros;
}

/** Lo escrito en el formulario de filtros, antes de aplicarlo. */
interface Borrador {
  usuarioId: string;
  accion: string;
  documentoId: string;
  desde: string;
  hasta: string;
}

function aBorrador(f: Filtros): Borrador {
  return {
    usuarioId: f.usuarioId === undefined ? '' : String(f.usuarioId),
    accion: f.accion ?? '',
    documentoId: f.documentoId === undefined ? '' : String(f.documentoId),
    desde: f.desde ?? '',
    hasta: f.hasta ?? '',
  };
}

type ErroresDeFiltros = Partial<Record<'documentoId' | 'desde' | 'hasta', string>>;

/**
 * Consulta de la auditoría (issue #25, solo administrador): los eventos más recientes primero, con filtros por usuario, acción,
 * documento y fechas, y paginada. Es solo lectura: la API no ofrece editar ni borrar eventos. Los filtros viven en la URL (se
 * pueden compartir, recargar y volver atrás). Las fechas se entienden en la hora de Colombia, la misma en que se muestran.
 */
export function Auditoria() {
  useTitulo('Auditoría');
  const { refrescar } = useSesion();
  const [parametros, setParametros] = useSearchParams();
  const filtros = useMemo(() => leerFiltros(parametros), [parametros]);
  const { usuarioId, accion, documentoId, desde, hasta, pagina } = filtros;
  const hayFiltros = [usuarioId, accion, documentoId, desde, hasta].some((v) => v !== undefined);

  // Lo escrito en el formulario se aplica al pulsar «Filtrar»; mientras tanto vive aquí. Si la URL cambia por otro camino
  // (Atrás, un enlace compartido), el formulario la sigue: se ajusta durante el render, como indica la documentación de React.
  const llave = aParametros({ ...filtros, pagina: 1 }).toString();
  const [borrador, setBorrador] = useState<Borrador>(() => aBorrador(filtros));
  const [llaveAplicada, setLlaveAplicada] = useState(llave);
  const [errores, setErrores] = useState<ErroresDeFiltros>({});
  const [intento, setIntento] = useState(0);
  if (llave !== llaveAplicada) {
    setLlaveAplicada(llave);
    setBorrador(aBorrador(filtros));
    setErrores({});
  }
  const formulario = useRef<HTMLFormElement>(null);
  useEnfocarPrimerError(formulario, intento);

  // La lista de usuarios sirve para elegir por nombre en el filtro; sin ella el filtro por usuario no se ofrece.
  const [usuarios] = useCarga(useCallback((senal: AbortSignal) => listarUsuarios(senal), []));
  const listaDeUsuarios = useMemo(() => (usuarios.tipo === 'listo' ? usuarios.datos : []), [usuarios]);

  const [carga, reintentar] = useCarga(
    useCallback(
      (senal: AbortSignal) =>
        consultarAuditoria(
          {
            usuarioId,
            accion,
            documentoId,
            desde: desde === undefined ? undefined : inicioDelDia(desde),
            hasta: hasta === undefined ? undefined : finDelDia(hasta),
            pagina,
            tamano: TAMANO_DE_PAGINA,
          },
          senal,
        ),
      [usuarioId, accion, documentoId, desde, hasta, pagina],
    ),
  );

  // Un 403 (el rol cambió mientras la pantalla estaba abierta): se vuelve a leer la sesión y la guarda de rutas decide.
  const perdioElRol = carga.tipo === 'error' && carga.error instanceof ErrorApi && carga.error.estado === 403 && carga.error.codigo === undefined;
  useEffect(() => {
    if (perdioElRol) void refrescar();
  }, [perdioElRol, refrescar]);

  // Una página que ya no existe (se editó la URL): se va a la última que sí.
  useEffect(() => {
    if (carga.tipo === 'listo' && carga.datos.items.length === 0 && carga.datos.total > 0 && pagina > 1) {
      setParametros(aParametros({ ...filtros, pagina: totalDePaginas(carga.datos.total, TAMANO_DE_PAGINA) }), { replace: true });
    }
  }, [carga, pagina, filtros, setParametros]);

  function filtrar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const nuevos: ErroresDeFiltros = {
      documentoId: validarNumeroDeDocumento(borrador.documentoId),
      desde: validarFechaDeFiltro(borrador.desde),
      hasta: validarFechaDeFiltro(borrador.hasta),
    };
    // El orden solo se compara si las dos fechas son válidas; si no, ya hay un error más concreto que mostrar.
    if (!nuevos.desde && !nuevos.hasta) nuevos.desde = validarOrdenDeFechas(borrador.desde, borrador.hasta);
    const conErrores = Object.fromEntries(Object.entries(nuevos).filter(([, mensaje]) => mensaje !== undefined)) as ErroresDeFiltros;
    setErrores(conErrores);
    if (Object.keys(conErrores).length > 0) {
      setIntento((n) => n + 1);
      return;
    }
    setParametros(
      aParametros({
        usuarioId: leerEntero(borrador.usuarioId),
        accion: borrador.accion === '' ? undefined : borrador.accion,
        documentoId: leerEntero(borrador.documentoId.trim()),
        desde: borrador.desde === '' ? undefined : borrador.desde,
        hasta: borrador.hasta === '' ? undefined : borrador.hasta,
        pagina: 1,
      }),
    );
  }

  function quitarFiltros() {
    setBorrador(aBorrador(leerFiltros(new URLSearchParams())));
    setErrores({});
    setParametros(new URLSearchParams());
  }

  const cambiar = (campo: keyof Borrador) => (valor: string) => setBorrador((actual) => ({ ...actual, [campo]: valor }));
  const usuarioDelFiltro = borrador.usuarioId;
  const noEstaEnLaLista = usuarioDelFiltro !== '' && !listaDeUsuarios.some((u) => String(u.id) === usuarioDelFiltro);

  return (
    <section aria-labelledby="titulo-auditoria">
      <h1 id="titulo-auditoria">Auditoría</h1>
      <p className="introduccion">
        Lo que ha pasado en el sistema: ingresos, cargas, descargas, versiones y cambios de usuarios, del más reciente al más antiguo.
        Solo se consulta: ningún evento se puede editar ni borrar. Las horas son las de Colombia.
      </p>

      <search aria-label="Filtrar la auditoría">
        <form ref={formulario} className="filtros filtros--auditoria" onSubmit={filtrar} noValidate>
          <Campo etiqueta="Usuario" sinMarca ayuda="Quién hizo la acción. Los ingresos fallidos no tienen usuario y no se pueden filtrar así.">
            {(propiedades) => (
              <select
                {...propiedades}
                name="usuarioId"
                value={usuarioDelFiltro}
                onChange={(e) => cambiar('usuarioId')(e.target.value)}
              >
                <option value="">Todos los usuarios</option>
                {noEstaEnLaLista && <option value={usuarioDelFiltro}>Usuario n.º {usuarioDelFiltro}</option>}
                {listaDeUsuarios.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nombre} ({u.usuario}){u.activo ? '' : ' · inactivo'}
                  </option>
                ))}
              </select>
            )}
          </Campo>

          <Campo etiqueta="Acción" sinMarca>
            {(propiedades) => (
              <select {...propiedades} name="accion" value={borrador.accion} onChange={(e) => cambiar('accion')(e.target.value)}>
                <option value="">Todas las acciones</option>
                {ACCIONES_FILTRABLES.map((a) => (
                  <option key={a} value={a}>
                    {etiquetaDeAccion(a)}
                  </option>
                ))}
              </select>
            )}
          </Campo>

          <Campo etiqueta="Número de documento" sinMarca ayuda="El número que sale en la dirección del documento." error={errores.documentoId}>
            {(propiedades) => (
              <input
                {...propiedades}
                name="documentoId"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                maxLength={10}
                value={borrador.documentoId}
                onChange={(e) => cambiar('documentoId')(e.target.value)}
              />
            )}
          </Campo>

          <Campo etiqueta="Desde" sinMarca ayuda="Desde el primer instante de ese día." error={errores.desde}>
            {(propiedades) => (
              <input
                {...propiedades}
                name="desde"
                type="date"
                min={`${ANIO_MINIMO}-01-01`}
                value={borrador.desde}
                onChange={(e) => cambiar('desde')(e.target.value)}
              />
            )}
          </Campo>

          <Campo etiqueta="Hasta" sinMarca ayuda="Hasta el último instante de ese día." error={errores.hasta}>
            {(propiedades) => (
              <input
                {...propiedades}
                name="hasta"
                type="date"
                min={`${ANIO_MINIMO}-01-01`}
                value={borrador.hasta}
                onChange={(e) => cambiar('hasta')(e.target.value)}
              />
            )}
          </Campo>

          <div className="filtros__acciones filtros__acciones--abajo">
            <button type="submit" className="boton boton--primario">
              Filtrar
            </button>
            {hayFiltros && (
              <button type="button" className="boton boton--secundario" onClick={quitarFiltros}>
                Quitar filtros
              </button>
            )}
          </div>
        </form>
      </search>
      {usuarios.tipo === 'error' && (
        <p className="aviso aviso--info">No se pudo cargar la lista de usuarios: el filtro por usuario no tiene nombres que ofrecer.</p>
      )}

      <div className="resultados" aria-busy={carga.tipo === 'cargando'}>
        {carga.tipo === 'cargando' && <output className="estado-carga">Cargando eventos…</output>}

        {carga.tipo === 'error' && (
          <div role="alert" className="aviso aviso--error aviso--bloque">
            <p>{traducirErrorDeAuditoria(carga.error)}</p>
            <button type="button" className="boton boton--secundario" onClick={reintentar}>
              Reintentar
            </button>
          </div>
        )}

        {carga.tipo === 'listo' && (
          <>
            <p className="resultados__linea">
              <output className="resultados__total">
                {carga.datos.total === 0
                  ? 'Sin eventos'
                  : `${carga.datos.total} ${carga.datos.total === 1 ? 'evento' : 'eventos'}`}
                {hayFiltros ? ' con estos filtros' : ''}
              </output>{' '}
              <button type="button" className="enlace-boton" onClick={reintentar}>
                Actualizar
              </button>
            </p>

            {carga.datos.items.length === 0 ? (
              <div className="vacio">
                {hayFiltros ? (
                  <p>Ningún evento coincide con los filtros. Prueba con otro rango de fechas o quita los filtros.</p>
                ) : (
                  <p>Todavía no hay eventos registrados.</p>
                )}
              </div>
            ) : (
              <ol className="lista-eventos">
                {carga.datos.items.map((evento) => (
                  <li key={evento.id} className="tarjeta">
                    <div className="tarjeta__cabecera">
                      <h2 className="tarjeta__titulo">{etiquetaDeAccion(evento.accion)}</h2>
                      <time dateTime={evento.creadoEn} className="tarjeta__fecha">
                        {formatearMomento(evento.creadoEn)}
                      </time>
                    </div>
                    <dl className="datos">
                      <div>
                        <dt>Quién</dt>
                        <dd>{evento.usuario ?? 'Sin identificar'}</dd>
                      </div>
                      <div>
                        <dt>Documento</dt>
                        <dd>
                          {evento.documentoId === null ? (
                            '—'
                          ) : (
                            <Link to={`/documentos/${evento.documentoId}`}>Documento {evento.documentoId}</Link>
                          )}
                        </dd>
                      </div>
                      <div className="datos__ancho">
                        <dt>Detalle</dt>
                        <dd>{evento.detalle ?? '—'}</dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ol>
            )}

            <Paginacion
              pagina={carga.datos.pagina}
              tamano={carga.datos.tamano}
              total={carga.datos.total}
              alCambiar={(nueva) => setParametros(aParametros({ ...filtros, pagina: nueva }))}
            />
          </>
        )}
      </div>
    </section>
  );
}
