import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { cargarDocumento, LIMITES, type Candidato, type DatosDeCarga, type UbicacionDeVersion } from '../api/documentos';
import { leerConflictoDeDuplicado, traducirError, type CampoDeFormulario } from '../api/errores';
import { listarSeries } from '../api/series';
import { Campo } from '../componentes/Campo';
import { CampoArchivo } from '../componentes/CampoArchivo';
import {
  ComparacionDeDuplicado,
  type ConflictoProbable,
  type DatosAComparar,
  type DecisionTomada,
} from '../componentes/ComparacionDeDuplicado';
import { mensajeDeError } from '../utilidades/mensajes';
import { nombreDeSubseriePorCodigo } from '../utilidades/series';
import { useCarga } from '../utilidades/useCarga';
import { useEnfocarPrimerError } from '../utilidades/useEnfocarPrimerError';
import { useTitulo } from '../utilidades/useTitulo';
import { validarArchivo, validarFecha, validarTexto } from '../utilidades/validacion';

type Errores = Partial<Record<CampoDeFormulario, string>>;

type Pantalla = { tipo: 'formulario' } | { tipo: 'duplicado'; conflicto: ConflictoProbable; datos: DatosAComparar };

function esCancelacion(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/**
 * Carga de un documento nuevo (issue #24). El formulario envía el PDF y sus datos; el servidor hace la verificación doble
 * (ADR-006): si el archivo ya existe lo rechaza (409 `duplicado_exacto`) y si hay uno muy parecido avisa (409
 * `duplicado_probable`), caso en que se muestra la pantalla de comparación y se reenvía el mismo archivo con la decisión.
 * El formulario sigue montado (oculto) mientras se ve la comparación, para no perder lo escrito ni el archivo elegido.
 */
export function CargarDocumento() {
  useTitulo('Cargar un documento');
  const navegar = useNavigate();

  const [archivo, setArchivo] = useState<File | null>(null);
  const [titulo, setTitulo] = useState('');
  const [expediente, setExpediente] = useState('');
  const [serieId, setSerieId] = useState('');
  const [fechaDocumento, setFechaDocumento] = useState('');
  const [motivo, setMotivo] = useState('');

  const [errores, setErrores] = useState<Errores>({});
  const [errorGeneral, setErrorGeneral] = useState<{ mensaje: string; enfocar: boolean } | null>(null);
  const [exacto, setExacto] = useState<UbicacionDeVersion | null>(null);
  const [errorDeDecision, setErrorDeDecision] = useState<string | undefined>(undefined);
  const [pantalla, setPantalla] = useState<Pantalla>({ tipo: 'formulario' });
  const [enviando, setEnviando] = useState(false);
  const [intento, setIntento] = useState(0);

  const enviandoAhora = useRef(false);
  const control = useRef<AbortController | null>(null);
  const encabezado = useRef<HTMLHeadingElement>(null);
  const formulario = useRef<HTMLFormElement>(null);
  const alerta = useRef<HTMLDivElement>(null);
  const alertaExacto = useRef<HTMLDivElement>(null);
  const pantallaAnterior = useRef<Pantalla['tipo']>('formulario');

  const [cuadro, recargarCuadro] = useCarga(useCallback((senal: AbortSignal) => listarSeries(senal), []));
  const series = cuadro.tipo === 'listo' ? cuadro.datos : [];

  useEnfocarPrimerError(formulario, intento);
  useEffect(() => {
    if (errorGeneral?.enfocar) alerta.current?.focus();
  }, [errorGeneral]);
  useEffect(() => {
    if (exacto) alertaExacto.current?.focus();
  }, [exacto]);
  // Al volver de la comparación al formulario, el foco regresa al título de la página.
  useEffect(() => {
    if (pantallaAnterior.current === 'duplicado' && pantalla.tipo === 'formulario') encabezado.current?.focus();
    pantallaAnterior.current = pantalla.tipo;
  }, [pantalla.tipo]);
  // Si se sale de la pantalla con una subida en curso, se cancela la petición.
  useEffect(() => () => control.current?.abort(), []);

  async function enviar(datos: DatosDeCarga) {
    if (enviandoAhora.current) return;
    enviandoAhora.current = true;
    setEnviando(true);
    setErrorGeneral(null);
    setErrorDeDecision(undefined);
    setExacto(null);
    control.current = new AbortController();
    try {
      const creado = await cargarDocumento(datos, control.current.signal);
      const aviso =
        datos.decision === 'nueva_version'
          ? `Se agregó el archivo como la versión ${creado.version.numero} del documento «${creado.documento.titulo}».`
          : `Documento «${creado.documento.titulo}» cargado: quedó como la versión ${creado.version.numero}.`;
      void navegar(`/documentos/${creado.documento.id}`, { state: { aviso } });
      return;
    } catch (fallo) {
      if (esCancelacion(fallo)) return;
      const conflicto = leerConflictoDeDuplicado(fallo);
      if (conflicto?.codigo === 'duplicado_probable' && datos.decision === undefined) {
        setPantalla({
          tipo: 'duplicado',
          conflicto,
          datos: {
            archivo: datos.archivo,
            titulo: datos.titulo.trim(),
            expediente: datos.expediente.trim(),
            serieId: datos.serieId,
            fechaDocumento: datos.fechaDocumento,
          },
        });
      } else if (conflicto?.codigo === 'duplicado_exacto') {
        // También puede llegar tras una decisión (otra persona cargó el mismo archivo entre medias): se vuelve al formulario.
        setPantalla({ tipo: 'formulario' });
        setExacto(conflicto.existente);
      } else {
        const traducido = traducirError(fallo, 'carga');
        if (datos.decision) {
          setErrorDeDecision(traducido.mensaje);
        } else {
          setErrores(traducido.campos);
          if (Object.keys(traducido.campos).length > 0) setIntento((n) => n + 1);
          setErrorGeneral({ mensaje: traducido.mensaje, enfocar: Object.keys(traducido.campos).length === 0 });
        }
      }
    }
    enviandoAhora.current = false;
    setEnviando(false);
  }

  function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviandoAhora.current) return;
    const nuevos: Errores = {
      archivo: validarArchivo(archivo),
      titulo: validarTexto(titulo, LIMITES.titulo, 'Escribe el título del documento.'),
      expediente: validarTexto(expediente, LIMITES.expediente, 'Escribe el número o código del expediente.'),
      serieId: serieId === '' ? 'Elige la subserie donde se clasifica el documento.' : undefined,
      fechaDocumento: validarFecha(fechaDocumento),
      motivo: validarTexto(motivo, LIMITES.motivo),
    };
    const conErrores = Object.fromEntries(Object.entries(nuevos).filter(([, mensaje]) => mensaje !== undefined)) as Errores;
    setErrores(conErrores);
    setErrorGeneral(null);
    setExacto(null);
    if (Object.keys(conErrores).length > 0 || archivo === null) {
      setIntento((n) => n + 1);
      return;
    }
    void enviar({
      archivo,
      titulo,
      expediente,
      serieId: Number(serieId),
      fechaDocumento,
      motivo,
    });
  }

  function alDecidir(decision: DecisionTomada) {
    if (pantalla.tipo !== 'duplicado') return;
    const { datos } = pantalla;
    void enviar({
      archivo: datos.archivo,
      titulo: datos.titulo,
      expediente: datos.expediente,
      serieId: datos.serieId,
      fechaDocumento: datos.fechaDocumento,
      // Una carga como documento distinto no cambia el motivo del formulario («Carga inicial» o el que se escribió);
      // como versión nueva, el motivo es el de la decisión.
      motivo: decision.decision === 'nueva_version' ? decision.motivo : motivo,
      decision: decision.decision,
      documentoId: decision.decision === 'nueva_version' ? decision.documentoId : undefined,
      justificacion: decision.decision === 'documento_distinto' ? decision.justificacion : undefined,
    });
  }

  function alDescartar(candidato: Candidato) {
    void navegar(`/documentos/${candidato.documentoId}`, {
      state: {
        aviso: `No se cargó nada: el archivo ya estaba en el sistema como «${candidato.titulo}».`,
      },
    });
  }

  function alVolver() {
    setErrorDeDecision(undefined);
    setPantalla({ tipo: 'formulario' });
  }

  const enFormulario = pantalla.tipo === 'formulario';

  return (
    <article aria-labelledby="titulo-carga" className="pagina-formulario">
      <h1 id="titulo-carga" ref={encabezado} tabIndex={-1}>
        Cargar un documento
      </h1>

      {pantalla.tipo === 'duplicado' && (
        <ComparacionDeDuplicado
          conflicto={pantalla.conflicto}
          datos={pantalla.datos}
          series={series}
          enviando={enviando}
          error={errorDeDecision}
          alDecidir={alDecidir}
          alDescartar={alDescartar}
          alVolver={alVolver}
        />
      )}

      <div hidden={!enFormulario}>
        <p className="introduccion">
          Sube un PDF y escribe sus datos. Antes de guardarlo, el sistema revisa si ese mismo archivo, o uno muy parecido (por ejemplo, un
          reescaneo), ya existe, para que no se dupliquen documentos.
        </p>

        {cuadro.tipo === 'error' && (
          <div role="alert" className="aviso aviso--error">
            <p>{mensajeDeError(cuadro.error)} No se pudo cargar el cuadro de clasificación, y sin él no se puede elegir la subserie.</p>
            <button type="button" className="boton boton--secundario" onClick={recargarCuadro}>
              Reintentar
            </button>
          </div>
        )}

        <form ref={formulario} onSubmit={alEnviar} noValidate aria-busy={enviando} className="formulario">
          <fieldset className="formulario__interior" disabled={enviando}>
            <legend className="visualmente-oculto">Datos del documento</legend>

            <CampoArchivo archivo={archivo} error={errores.archivo} alCambiar={setArchivo} />

            <Campo
              etiqueta="Título"
              obligatorio
              ayuda="El nombre con el que se buscará el documento, por ejemplo «Acta de comité n.º 12»."
              error={errores.titulo}
              contador={{ actual: titulo.length, maximo: LIMITES.titulo }}
            >
              {(propiedades) => (
                <input
                  {...propiedades}
                  name="titulo"
                  type="text"
                  autoComplete="off"
                  maxLength={LIMITES.titulo}
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                />
              )}
            </Campo>

            <Campo
              etiqueta="Expediente"
              obligatorio
              ayuda="El código del expediente al que pertenece, por ejemplo EXP-2026-014."
              error={errores.expediente}
            >
              {(propiedades) => (
                <input
                  {...propiedades}
                  name="expediente"
                  type="text"
                  autoComplete="off"
                  maxLength={LIMITES.expediente}
                  value={expediente}
                  onChange={(e) => setExpediente(e.target.value)}
                />
              )}
            </Campo>

            <Campo
              etiqueta="Subserie"
              obligatorio
              ayuda="Dónde se clasifica en el cuadro de clasificación documental. Solo las subseries admiten documentos."
              error={errores.serieId}
            >
              {(propiedades) => (
                <select {...propiedades} name="serieId" value={serieId} onChange={(e) => setSerieId(e.target.value)}>
                  <option value="">Elige una subserie</option>
                  {series
                    .filter((serie) => serie.subseries.length > 0)
                    .map((serie) => (
                      <optgroup key={serie.id} label={`${serie.codigo} · ${serie.nombre}`}>
                        {serie.subseries.map((subserie) => (
                          <option key={subserie.id} value={subserie.id}>
                            {subserie.codigo} · {subserie.nombre}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                </select>
              )}
            </Campo>

            <Campo
              etiqueta="Fecha del documento"
              obligatorio
              ayuda="La fecha que figura en el documento, no la de hoy. Formato AAAA-MM-DD."
              error={errores.fechaDocumento}
            >
              {(propiedades) => (
                <input
                  {...propiedades}
                  name="fechaDocumento"
                  type="date"
                  min="1900-01-01"
                  value={fechaDocumento}
                  onChange={(e) => setFechaDocumento(e.target.value)}
                />
              )}
            </Campo>

            <Campo
              etiqueta="Motivo de la carga"
              ayuda="Si lo dejas vacío se guarda como «Carga inicial»."
              error={errores.motivo}
              contador={{ actual: motivo.length, maximo: LIMITES.motivo }}
            >
              {(propiedades) => (
                <input
                  {...propiedades}
                  name="motivo"
                  type="text"
                  autoComplete="off"
                  maxLength={LIMITES.motivo}
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                />
              )}
            </Campo>
          </fieldset>

          {exacto && (
            <div ref={alertaExacto} tabIndex={-1} role="alert" className="aviso aviso--error aviso--exacto">
              <h2>Este archivo ya está en el sistema</h2>
              <p>
                Es idéntico, byte por byte, a la versión {exacto.version} del documento «{exacto.titulo}» (expediente {exacto.expediente},
                subserie {nombreDeSubseriePorCodigo(series, exacto.serieCodigo)}). El mismo archivo no se puede cargar dos veces, para no
                duplicar documentos.
              </p>
              <p>
                <Link to={`/documentos/${exacto.documentoId}`}>Abrir el documento «{exacto.titulo}»</Link>
              </p>
              <p>Si lo que tienes es una corrección, guarda el archivo corregido y súbelo como versión nueva de ese documento.</p>
            </div>
          )}

          {errorGeneral && (
            <div ref={alerta} tabIndex={-1} role="alert" className="aviso aviso--error">
              <p>{errorGeneral.mensaje}</p>
            </div>
          )}

          <div className="acciones acciones--formulario">
            <button type="submit" className="boton boton--primario" disabled={enviando}>
              {enviando ? 'Subiendo el documento…' : 'Cargar documento'}
            </button>
            <Link className="boton boton--secundario" to="/documentos">
              Cancelar
            </Link>
          </div>
        </form>
      </div>
    </article>
  );
}
