import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import {
  LIMITES,
  obtenerDocumento,
  urlDeArchivo,
  type Candidato,
  type ConflictoDeDuplicado,
  type Decision,
} from '../api/documentos';
import type { Serie } from '../api/series';
import { formatearFecha, formatearFechaHora, formatearTamano, porcentajeDeSimilitud } from '../utilidades/formato';
import { nombreDeSubseriePorCodigo, nombreDeSubseriePorId } from '../utilidades/series';
import { useCarga } from '../utilidades/useCarga';
import { useEnfocarPrimerError } from '../utilidades/useEnfocarPrimerError';
import { validarTexto } from '../utilidades/validacion';
import { Campo } from './Campo';

/** El 409 `duplicado_probable` de `POST /documentos`. */
export type ConflictoProbable = Extract<ConflictoDeDuplicado, { codigo: 'duplicado_probable' }>;

/** Lo que la persona escribió y eligió en el formulario, tal como se envió: es el lado «nuevo» de la comparación. */
export interface DatosAComparar {
  archivo: File;
  titulo: string;
  expediente: string;
  serieId: number;
  fechaDocumento: string;
}

/** La decisión que se reenvía a la API junto con el mismo archivo. */
export type DecisionTomada =
  | { decision: Extract<Decision, 'nueva_version'>; documentoId: number; motivo: string }
  | { decision: Extract<Decision, 'documento_distinto'>; justificacion: string };

type Eleccion = 'mismo' | Decision | '';

interface Propiedades {
  conflicto: ConflictoProbable;
  datos: DatosAComparar;
  series: readonly Serie[];
  /** Hay una petición en curso: se deshace todo para que no se envíe dos veces. */
  enviando: boolean;
  /** Error de la última petición de decisión, ya traducido. */
  error: string | undefined;
  /** La persona decidió `nueva_version` o `documento_distinto`: el contenedor reenvía el archivo con la decisión. */
  alDecidir: (decision: DecisionTomada) => void;
  /** «Es el mismo documento»: no se carga nada y se lleva al documento que ya existe. */
  alDescartar: (candidato: Candidato) => void;
  /** Volver al formulario para corregir los datos o cambiar el archivo. */
  alVolver: () => void;
}

/** El documento que ya existe, con lo que la API del aviso trae y, si llega, el detalle (fecha, autor y versión vigente). */
function DocumentoExistente({ candidato, series, umbral }: { candidato: Candidato; series: readonly Serie[]; umbral: number }) {
  const [carga] = useCarga(useCallback((senal: AbortSignal) => obtenerDocumento(candidato.documentoId, senal), [candidato.documentoId]));
  const documento = carga.tipo === 'listo' ? carga.datos : null;
  const vigente = documento?.versiones[0];
  const coincidente = documento?.versiones.find((v) => v.numero === candidato.version);
  const idTitulo = useId();

  return (
    <section className="comparacion__lado comparacion__lado--existe" aria-labelledby={idTitulo}>
      <p className="comparacion__rotulo">Ya existe en el sistema</p>
      <h3 id={idTitulo} className="comparacion__titulo">
        {candidato.titulo}
      </h3>
      <p className="comparacion__similitud">
        <strong>{porcentajeDeSimilitud(candidato.similitud)}</strong> de parecido en el texto
        <span className="comparacion__umbral"> (el aviso salta desde {porcentajeDeSimilitud(umbral)})</span>
      </p>
      <dl className="datos datos--apilados">
        <div>
          <dt>Expediente</dt>
          <dd>{candidato.expediente}</dd>
        </div>
        <div>
          <dt>Subserie</dt>
          <dd>{nombreDeSubseriePorCodigo(series, candidato.serieCodigo)}</dd>
        </div>
        <div>
          <dt>Fecha del documento</dt>
          <dd>{documento ? formatearFecha(documento.fechaDocumento) : '…'}</dd>
        </div>
        <div>
          <dt>Versión parecida</dt>
          <dd>
            {candidato.version}
            {vigente ? (vigente.numero === candidato.version ? ' (la vigente)' : ` (la vigente es la ${vigente.numero})`) : ''}
          </dd>
        </div>
        <div>
          <dt>Cargada por</dt>
          <dd>{coincidente ? coincidente.autor : '…'}</dd>
        </div>
        <div>
          <dt>Cargada el</dt>
          <dd>{coincidente ? formatearFechaHora(coincidente.creadoEn) : '…'}</dd>
        </div>
      </dl>
      {carga.tipo === 'cargando' && <output className="nota">Cargando la fecha y el autor…</output>}
      {carga.tipo === 'error' && (
        <p className="nota">No se pudieron cargar la fecha ni el autor. Puedes decidir igual con lo que se muestra.</p>
      )}
      <p className="comparacion__enlaces">
        <Link to={`/documentos/${candidato.documentoId}`} target="_blank" rel="noopener noreferrer">
          Ver el documento (se abre en otra pestaña)
        </Link>
        <a href={urlDeArchivo(candidato.documentoId, candidato.version)} download>
          Descargar la versión {candidato.version} (PDF)
        </a>
      </p>
    </section>
  );
}

/** El archivo que se intenta cargar, con los datos escritos y un enlace para abrir el PDF en otra pestaña. */
function ArchivoNuevo({ datos, series }: { datos: DatosAComparar; series: readonly Serie[] }) {
  const [direccion, setDireccion] = useState<string | null>(null);
  const idTitulo = useId();

  // El PDF no se incrusta (la política de contenido de la API no admite `iframe` ni `object`): se abre en otra pestaña
  // con una dirección `blob:` creada en el navegador. Se libera al salir de la pantalla. La dirección es un recurso externo
  // que se crea y se libera con el efecto, por eso se guarda en el estado desde aquí.
  useEffect(() => {
    const url = URL.createObjectURL(datos.archivo);
    // oxlint-disable-next-line react/set-state-in-effect
    setDireccion(url);
    return () => URL.revokeObjectURL(url);
  }, [datos.archivo]);

  return (
    <section className="comparacion__lado comparacion__lado--nuevo" aria-labelledby={idTitulo}>
      <p className="comparacion__rotulo">Lo que intentas cargar</p>
      <h3 id={idTitulo} className="comparacion__titulo">
        {datos.titulo}
      </h3>
      <p className="comparacion__similitud">Archivo nuevo, todavía sin guardar</p>
      <dl className="datos datos--apilados">
        <div>
          <dt>Archivo</dt>
          <dd>{datos.archivo.name}</dd>
        </div>
        <div>
          <dt>Tamaño</dt>
          <dd>{formatearTamano(datos.archivo.size)}</dd>
        </div>
        <div>
          <dt>Expediente</dt>
          <dd>{datos.expediente}</dd>
        </div>
        <div>
          <dt>Subserie</dt>
          <dd>{nombreDeSubseriePorId(series, datos.serieId) ?? String(datos.serieId)}</dd>
        </div>
        <div>
          <dt>Fecha del documento</dt>
          <dd>{formatearFecha(datos.fechaDocumento)}</dd>
        </div>
      </dl>
      <p className="comparacion__enlaces">
        {direccion && (
          <a href={direccion} target="_blank" rel="noopener noreferrer">
            Abrir el PDF nuevo (se abre en otra pestaña)
          </a>
        )}
      </p>
    </section>
  );
}

/**
 * La pantalla de aviso de duplicado probable (ADR-006): el documento que ya existe al lado del archivo que se intenta
 * cargar, y las tres cosas que se pueden hacer. La similitud solo avisa; decide la persona. Cada decisión dice qué pasará.
 */
export function ComparacionDeDuplicado({ conflicto, datos, series, enviando, error, alDecidir, alDescartar, alVolver }: Propiedades) {
  const { candidatos, umbral } = conflicto;
  const [seleccionado, setSeleccionado] = useState(candidatos[0].documentoId);
  const [eleccion, setEleccion] = useState<Eleccion>('');
  const [motivo, setMotivo] = useState('');
  const [justificacion, setJustificacion] = useState('');
  const [errores, setErrores] = useState<{ eleccion?: string; motivo?: string; justificacion?: string }>({});
  const [intento, setIntento] = useState(0);

  const base = useId();
  const titulo = useRef<HTMLHeadingElement>(null);
  const formulario = useRef<HTMLFormElement>(null);
  const alerta = useRef<HTMLDivElement>(null);

  // Al aparecer la pantalla el foco va a su título: quien usa teclado o lector de pantalla se entera del cambio.
  useEffect(() => {
    titulo.current?.focus();
  }, []);
  useEnfocarPrimerError(formulario, intento);
  useEffect(() => {
    if (error) alerta.current?.focus();
  }, [error]);

  const candidato = candidatos.find((c) => c.documentoId === seleccionado) ?? candidatos[0];

  function confirmar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviando) return;
    const nuevos = {
      eleccion: eleccion === '' ? 'Elige qué quieres hacer con este archivo.' : undefined,
      motivo:
        eleccion === 'nueva_version'
          ? validarTexto(motivo, LIMITES.motivo, 'Escribe el motivo: explica qué cambió respecto a la versión que ya existe.')
          : undefined,
      justificacion:
        eleccion === 'documento_distinto'
          ? validarTexto(justificacion, LIMITES.justificacion, 'Escribe la justificación: explica por qué no es un duplicado.')
          : undefined,
    };
    setErrores(nuevos);
    if (nuevos.eleccion || nuevos.motivo || nuevos.justificacion) {
      setIntento((n) => n + 1);
      return;
    }
    if (eleccion === 'mismo') {
      alDescartar(candidato);
    } else if (eleccion === 'nueva_version') {
      alDecidir({ decision: 'nueva_version', documentoId: candidato.documentoId, motivo: motivo.trim() });
    } else if (eleccion === 'documento_distinto') {
      alDecidir({ decision: 'documento_distinto', justificacion: justificacion.trim() });
    }
  }

  const textoDelBoton =
    eleccion === 'mismo'
      ? 'No cargar el archivo'
      : eleccion === 'nueva_version'
        ? 'Agregar como versión nueva'
        : eleccion === 'documento_distinto'
          ? 'Cargar como documento nuevo'
          : 'Confirmar mi decisión';

  return (
    <section className="duplicado" aria-labelledby={`${base}-titulo`}>
      <h2 id={`${base}-titulo`} ref={titulo} tabIndex={-1}>
        Este archivo se parece a un documento que ya existe
      </h2>
      <p>
        El texto del PDF que intentas cargar es muy parecido al de {candidatos.length === 1 ? 'un documento ya guardado' : `${candidatos.length} documentos ya guardados`}.
        Puede ser un reescaneo o una copia. El sistema solo avisa: <strong>decides tú</strong>. Compara los dos y elige qué hacer.
      </p>

      {candidatos.length > 1 && (
        <fieldset className="grupo">
          <legend>Elige con cuál quieres comparar</legend>
          {candidatos.map((c) => {
            const elegido = c.documentoId === candidato.documentoId;
            // Cada candidato es una fila en bloque (el recuadro es un <div>, no el <label>): una por línea, con el texto
            // completo y la fila entera como área de clic. Si el recuadro fuera el propio <label> (en línea), las filas
            // se montarían unas sobre otras.
            return (
              <div key={c.documentoId} className={`opcion opcion--simple${elegido ? ' opcion--activa' : ''}`}>
                <label>
                  <input
                    type="radio"
                    name={`${base}-candidato`}
                    checked={elegido}
                    disabled={enviando}
                    onChange={() => setSeleccionado(c.documentoId)}
                  />
                  <span className="opcion__texto">
                    <span className="opcion__titulo">«{c.titulo}»</span> · expediente {c.expediente} · {porcentajeDeSimilitud(c.similitud)} de parecido
                  </span>
                </label>
              </div>
            );
          })}
        </fieldset>
      )}

      <div className="comparacion">
        <DocumentoExistente key={candidato.documentoId} candidato={candidato} series={series} umbral={umbral} />
        <ArchivoNuevo datos={datos} series={series} />
      </div>

      <form ref={formulario} onSubmit={confirmar} noValidate className="decision">
        <fieldset className="grupo" disabled={enviando}>
          <legend>¿Qué quieres hacer?</legend>

          <div className={eleccion === 'mismo' ? 'opcion opcion--activa' : 'opcion'}>
            <label>
              <input
                type="radio"
                name={`${base}-decision`}
                value="mismo"
                checked={eleccion === 'mismo'}
                onChange={() => setEleccion('mismo')}
                data-error={errores.eleccion ? 'true' : undefined}
                aria-describedby={errores.eleccion ? `${base}-mismo ${base}-error-decision` : `${base}-mismo`}
              />
              <span className="opcion__titulo">Es el mismo documento: no cargar nada</span>
            </label>
            <p id={`${base}-mismo`} className="opcion__efecto">
              No se guarda este archivo y no cambia nada en el sistema. Te llevamos al documento que ya existe.
            </p>
          </div>

          <div className={eleccion === 'nueva_version' ? 'opcion opcion--activa' : 'opcion'}>
            <label>
              <input
                type="radio"
                name={`${base}-decision`}
                value="nueva_version"
                checked={eleccion === 'nueva_version'}
                onChange={() => setEleccion('nueva_version')}
                aria-describedby={`${base}-nueva`}
              />
              <span className="opcion__titulo">Es una versión nueva de «{candidato.titulo}»</span>
            </label>
            <p id={`${base}-nueva`} className="opcion__efecto">
              Este archivo se agrega como una versión más del documento que ya existe y pasa a ser la vigente. Las versiones anteriores
              quedan en el historial. El título, el expediente, la subserie y la fecha que escribiste no cambian los del documento existente.
            </p>
            {eleccion === 'nueva_version' && (
              <Campo
                etiqueta="Motivo de la versión nueva"
                obligatorio
                ayuda="Explica qué cambió respecto a la versión que ya existe, por ejemplo «Reescaneo con mejor calidad»."
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
            )}
          </div>

          <div className={eleccion === 'documento_distinto' ? 'opcion opcion--activa' : 'opcion'}>
            <label>
              <input
                type="radio"
                name={`${base}-decision`}
                value="documento_distinto"
                checked={eleccion === 'documento_distinto'}
                onChange={() => setEleccion('documento_distinto')}
                aria-describedby={`${base}-distinto`}
              />
              <span className="opcion__titulo">Es otro documento: cargarlo de todos modos</span>
            </label>
            <p id={`${base}-distinto`} className="opcion__efecto">
              Se crea un documento nuevo con los datos que escribiste; el que ya existe queda como está. Tu justificación queda
              registrada en la auditoría.
            </p>
            {eleccion === 'documento_distinto' && (
              <Campo
                etiqueta="Justificación"
                obligatorio
                ayuda="Explica por qué no es un duplicado, por ejemplo «Es el contrato del segundo lote: usa la misma plantilla»."
                error={errores.justificacion}
                contador={{ actual: justificacion.length, maximo: LIMITES.justificacion }}
              >
                {(propiedades) => (
                  <textarea
                    {...propiedades}
                    name="justificacion"
                    rows={3}
                    maxLength={LIMITES.justificacion}
                    value={justificacion}
                    onChange={(e) => setJustificacion(e.target.value)}
                  />
                )}
              </Campo>
            )}
          </div>
          {errores.eleccion && (
            <p className="campo__error" id={`${base}-error-decision`}>
              {errores.eleccion}
            </p>
          )}
        </fieldset>

        {error && (
          <div ref={alerta} tabIndex={-1} role="alert" className="aviso aviso--error">
            <p>{error}</p>
          </div>
        )}

        <div className="acciones acciones--formulario">
          <button type="submit" className="boton boton--primario" disabled={enviando}>
            {enviando ? 'Guardando…' : textoDelBoton}
          </button>
          <button type="button" className="boton boton--secundario" onClick={alVolver} disabled={enviando}>
            Volver y corregir los datos
          </button>
        </div>
      </form>
    </section>
  );
}
