import { useCallback, useEffect, useRef, useState } from 'react';
import { traducirErrorDeUsuarios } from '../api/errores-administracion';
import { cambiarUsuario, listarUsuarios, type UsuarioAdministrado } from '../api/usuarios';
import { CambiarRolDeUsuario } from '../componentes/CambiarRolDeUsuario';
import { CrearUsuario } from '../componentes/CrearUsuario';
import { DesactivarUsuario } from '../componentes/DesactivarUsuario';
import { useSesion } from '../sesion/contexto';
import { formatearFechaHora } from '../utilidades/formato';
import { ETIQUETA_DE_ROL } from '../utilidades/roles';
import { useCarga } from '../utilidades/useCarga';
import { useTitulo } from '../utilidades/useTitulo';

/** Lo que está abierto bajo la lista: el formulario de alta, o el panel de una acción sobre un usuario. */
type Panel = { tipo: 'crear' } | { tipo: 'rol'; id: number } | { tipo: 'desactivar'; id: number } | null;

/** Devuelve el foco a un botón que ya existe (el que abrió el panel que se cerró). */
function enfocarBoton(id: string) {
  setTimeout(() => document.getElementById(id)?.focus(), 0);
}

function resumen(lista: readonly UsuarioAdministrado[]): string {
  const activos = lista.filter((u) => u.activo).length;
  const total = `${lista.length} ${lista.length === 1 ? 'usuario' : 'usuarios'}`;
  return `${total} · ${activos} ${activos === 1 ? 'activo' : 'activos'}`;
}

/**
 * Administración de usuarios (issue #25, solo administrador): la lista, el alta, el cambio de rol, y desactivar y reactivar.
 * Nadie se borra (ADR-008). Cada cambio se confirma en un panel que dice qué pasará; la lista se actualiza con lo que responde
 * la API, sin recargarla, y los errores (último administrador, nombre repetido, validaciones) se explican en español.
 */
export function Usuarios() {
  useTitulo('Usuarios');
  const { estado, salir, refrescar } = useSesion();
  const yo = estado.tipo === 'autenticado' ? estado.usuario.id : null;

  const [carga, reintentar] = useCarga(useCallback((senal: AbortSignal) => listarUsuarios(senal), []));
  // La lista que se ve. Nace de lo que responde la API y se corrige con cada respuesta de un cambio, así la pantalla no se
  // vacía ni salta mientras se vuelve a pedir. Se ajusta durante el render cuando llega una lista nueva (patrón de React).
  const [lista, setLista] = useState<UsuarioAdministrado[] | null>(null);
  const [origen, setOrigen] = useState<UsuarioAdministrado[] | null>(null);
  if (carga.tipo === 'listo' && carga.datos !== origen) {
    setOrigen(carga.datos);
    setLista(carga.datos);
  }

  const [panel, setPanel] = useState<Panel>(null);
  const [aviso, setAviso] = useState<{ texto: string; numero: number } | null>(null);
  const [errorDeAccion, setErrorDeAccion] = useState<string | null>(null);
  const [reactivando, setReactivando] = useState<number | null>(null);
  const salidaDelAviso = useRef<HTMLOutputElement>(null);

  // El aviso de éxito recibe el foco para que se note con teclado y lector de pantalla.
  useEffect(() => {
    if (aviso) salidaDelAviso.current?.focus();
  }, [aviso]);

  function avisar(texto: string) {
    setAviso((anterior) => ({ texto, numero: (anterior?.numero ?? 0) + 1 }));
  }

  function reemplazar(actualizado: UsuarioAdministrado) {
    setLista((actual) => actual?.map((u) => (u.id === actualizado.id ? actualizado : u)) ?? actual);
  }

  function abrir(nuevo: Panel) {
    setPanel(nuevo);
    setAviso(null);
    setErrorDeAccion(null);
  }

  /** Un 403 de rol: la interfaz pudo quedarse con un rol viejo; se vuelve a leer y la guarda de rutas decide qué mostrar. */
  function alFallar(fallo: unknown) {
    if (traducirErrorDeUsuarios(fallo, 'cambio').rolDesactualizado) void refrescar();
  }

  function alCrear(creado: UsuarioAdministrado) {
    setLista((actual) => [...(actual ?? []), creado]);
    setPanel(null);
    avisar(
      `Se creó el usuario «${creado.usuario}» (${creado.nombre}) con el rol ${ETIQUETA_DE_ROL[creado.rol]}. Entrégale su clave inicial por otro medio: el sistema no vuelve a mostrarla.`,
    );
  }

  function alCambiarRol(actualizado: UsuarioAdministrado) {
    reemplazar(actualizado);
    setPanel(null);
    avisar(`Se cambió el rol de ${actualizado.nombre}: ahora es ${ETIQUETA_DE_ROL[actualizado.rol]}. Rige desde ya.`);
    // El rol propio pudo cambiar (de administrador a otro): se vuelve a leer la sesión y la guarda decide si esta pantalla sigue.
    if (actualizado.id === yo) void refrescar();
  }

  function alDesactivar(actualizado: UsuarioAdministrado) {
    reemplazar(actualizado);
    setPanel(null);
    avisar(`Se desactivó a ${actualizado.nombre}. Sus sesiones se cerraron y ya no puede ingresar.`);
    // La API cerró también la sesión de quien se desactivó a sí mismo: la interfaz sale al ingreso.
    if (actualizado.id === yo) void salir();
  }

  async function reactivar(usuario: UsuarioAdministrado) {
    if (reactivando !== null) return;
    setReactivando(usuario.id);
    setErrorDeAccion(null);
    setAviso(null);
    try {
      const actualizado = await cambiarUsuario(usuario.id, { activo: true });
      reemplazar(actualizado);
      avisar(`Se reactivó a ${actualizado.nombre}. Ya puede ingresar de nuevo.`);
    } catch (fallo) {
      setErrorDeAccion(traducirErrorDeUsuarios(fallo, 'cambio', { usuario: usuario.usuario }).mensaje);
      alFallar(fallo);
    } finally {
      setReactivando(null);
    }
  }

  const errorDeCarga = carga.tipo === 'error' ? traducirErrorDeUsuarios(carga.error, 'listar') : null;
  // Un 403 al pedir la lista tampoco debe dejar la pantalla con un rol que ya no es: se vuelve a leer la sesión una vez.
  const pedirRolOtraVez = errorDeCarga?.rolDesactualizado ?? false;
  useEffect(() => {
    if (pedirRolOtraVez) void refrescar();
  }, [pedirRolOtraVez, refrescar]);

  return (
    <section aria-labelledby="titulo-usuarios">
      <h1 id="titulo-usuarios">Usuarios</h1>
      <p className="introduccion">
        Quién puede ingresar y con qué rol. Los usuarios no se borran: desactivar a alguien cierra sus sesiones y conserva el
        registro de lo que hizo.
      </p>

      {aviso && (
        <output key={aviso.numero} ref={salidaDelAviso} tabIndex={-1} className="aviso aviso--ok aviso--bloque">
          {aviso.texto}
        </output>
      )}

      {errorDeAccion && (
        <div role="alert" className="aviso aviso--error aviso--bloque">
          <p>{errorDeAccion}</p>
        </div>
      )}

      {panel?.tipo === 'crear' ? (
        <CrearUsuario
          alCrear={alCrear}
          alCancelar={() => {
            setPanel(null);
            enfocarBoton('boton-crear-usuario');
          }}
          alPerderElRol={() => void refrescar()}
        />
      ) : (
        <div className="acciones">
          <button type="button" id="boton-crear-usuario" className="boton boton--primario" onClick={() => abrir({ tipo: 'crear' })}>
            Crear usuario
          </button>
        </div>
      )}

      <div className="resultados" aria-busy={carga.tipo === 'cargando'}>
        {lista === null && carga.tipo === 'cargando' && <output className="estado-carga">Cargando usuarios…</output>}

        {errorDeCarga && (
          <div role="alert" className="aviso aviso--error aviso--bloque">
            <p>{errorDeCarga.mensaje}</p>
            <button type="button" className="boton boton--secundario" onClick={reintentar}>
              Reintentar
            </button>
          </div>
        )}

        {lista !== null && (
          <>
            <output className="resultados__total">{resumen(lista)}</output>
            {lista.length === 0 ? (
              <div className="vacio">
                <p>Todavía no hay usuarios.</p>
              </div>
            ) : (
              <ul className="lista-usuarios">
                {lista.map((u) => {
                  const esYo = u.id === yo;
                  const abierto = panel !== null && panel.tipo !== 'crear' && panel.id === u.id ? panel.tipo : null;
                  return (
                    <li key={u.id} className={u.activo ? 'tarjeta' : 'tarjeta tarjeta--inactiva'}>
                      <div className="tarjeta__cabecera">
                        <h2 className="tarjeta__titulo">
                          {u.nombre}
                          {esYo && <span className="etiqueta">Tú</span>}
                          {!u.activo && <span className="etiqueta etiqueta--inactiva">Inactivo</span>}
                        </h2>
                        <div className="tarjeta__acciones">
                          <button
                            type="button"
                            id={`boton-rol-${u.id}`}
                            className="boton boton--secundario"
                            aria-label={`Cambiar rol de ${u.nombre}`}
                            aria-expanded={abierto === 'rol'}
                            onClick={() => abrir({ tipo: 'rol', id: u.id })}
                          >
                            Cambiar rol
                          </button>
                          {u.activo ? (
                            <button
                              type="button"
                              id={`boton-desactivar-${u.id}`}
                              className="boton boton--secundario"
                              aria-label={`Desactivar a ${u.nombre}`}
                              aria-expanded={abierto === 'desactivar'}
                              onClick={() => abrir({ tipo: 'desactivar', id: u.id })}
                            >
                              Desactivar
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="boton boton--secundario"
                              aria-label={`${reactivando === u.id ? 'Reactivando' : 'Reactivar'} a ${u.nombre}`}
                              disabled={reactivando !== null}
                              onClick={() => void reactivar(u)}
                            >
                              {reactivando === u.id ? 'Reactivando…' : 'Reactivar'}
                            </button>
                          )}
                        </div>
                      </div>
                      <dl className="datos">
                        <div>
                          <dt>Usuario</dt>
                          <dd>{u.usuario}</dd>
                        </div>
                        <div>
                          <dt>Rol</dt>
                          <dd>{ETIQUETA_DE_ROL[u.rol]}</dd>
                        </div>
                        <div>
                          <dt>Estado</dt>
                          <dd>{u.activo ? 'Activo' : 'Inactivo: no puede ingresar'}</dd>
                        </div>
                        <div>
                          <dt>Creado</dt>
                          <dd>{formatearFechaHora(u.creadoEn)}</dd>
                        </div>
                      </dl>
                      {abierto === 'rol' && (
                        <CambiarRolDeUsuario
                          usuario={u}
                          esYo={esYo}
                          alCambiar={alCambiarRol}
                          alCancelar={() => {
                            setPanel(null);
                            enfocarBoton(`boton-rol-${u.id}`);
                          }}
                          alFallar={alFallar}
                        />
                      )}
                      {abierto === 'desactivar' && (
                        <DesactivarUsuario
                          usuario={u}
                          esYo={esYo}
                          alDesactivar={alDesactivar}
                          alCancelar={() => {
                            setPanel(null);
                            enfocarBoton(`boton-desactivar-${u.id}`);
                          }}
                          alFallar={alFallar}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="nota resultados__linea">
              <button type="button" className="enlace-boton" onClick={reintentar}>
                Actualizar la lista
              </button>{' '}
              por si otro administrador hizo cambios.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
