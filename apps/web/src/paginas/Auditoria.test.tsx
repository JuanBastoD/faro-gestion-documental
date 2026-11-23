import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Rol } from '../api/auth';
import { eventoDePrueba, listaDeUsuarios, paginaDeEventos } from '../pruebas/administracion';
import { manejadoresDeSesion, renderizarApp, respuestaJson, simularApi } from '../pruebas/ayudas';

type Manejadores = Parameters<typeof simularApi>[0];

const EVENTOS = [
  eventoDePrueba(3),
  eventoDePrueba(2, {
    accion: 'usuario_rol_cambiado',
    usuarioId: 1,
    usuario: 'administrador.demo',
    documentoId: null,
    detalle: 'usuario 3 (consulta.demo); rol consulta → editor',
  }),
  eventoDePrueba(1, { accion: 'ingreso_fallido', usuarioId: null, usuario: null, documentoId: null, detalle: 'usuario inexistente' }),
];

function montar(opciones: { rol?: Rol; extra?: Manejadores; ruta?: string } = {}) {
  const api = simularApi({
    ...manejadoresDeSesion(opciones.rol ?? 'administrador'),
    'GET /usuarios': () => respuestaJson(listaDeUsuarios()),
    'GET /auditoria': () => respuestaJson(paginaDeEventos(EVENTOS)),
    ...opciones.extra,
  });
  renderizarApp(opciones.ruta ?? '/auditoria');
  return api;
}

type Api = ReturnType<typeof montar>;

/** Los parámetros de la última consulta a `GET /auditoria`. */
function ultimaConsulta(api: Api): URLSearchParams {
  const llamadas = api.a('GET', '/auditoria');
  const ultima = llamadas[llamadas.length - 1];
  if (!ultima) throw new Error('No hubo consulta a /auditoria');
  return ultima.consulta;
}

const ubicacion = () => screen.getByTestId('ubicacion').textContent;
const boton = (nombre: string | RegExp) => screen.getByRole('button', { name: nombre });

async function esperarEventos() {
  await screen.findByRole('heading', { level: 2, name: 'Carga de documento' });
}

/** Espera a que el filtro de usuario tenga los nombres (llegan de `GET /usuarios`). */
async function esperarUsuarios() {
  await screen.findByRole('option', { name: 'Editor Demo (editor.demo)' });
}

describe('lista de eventos', () => {
  it('muestra cada evento con su acción en español, quién, el documento, el detalle y la hora de Colombia con segundos', async () => {
    montar();
    expect(await screen.findByRole('heading', { level: 1, name: 'Auditoría' })).toBeInTheDocument();
    await esperarEventos();
    expect(screen.getByText('3 eventos')).toBeInTheDocument();

    const carga = screen.getByRole('heading', { level: 2, name: 'Carga de documento' }).closest('li');
    if (!carga) throw new Error('sin tarjeta');
    expect(within(carga).getByText('editor.demo')).toBeInTheDocument();
    expect(within(carga).getByRole('link', { name: 'Documento 12' })).toHaveAttribute('href', '/documentos/12');
    expect(within(carga).getByText('Documento «Acta de comité 12»')).toBeInTheDocument();
    // 15:05:30 UTC son las 10:05:30 en Colombia.
    expect(within(carga).getByText(/10:05:30/)).toHaveAttribute('datetime', '2026-11-23T15:05:30.000Z');

    const cambio = screen.getByRole('heading', { level: 2, name: 'Rol de usuario cambiado' }).closest('li');
    if (!cambio) throw new Error('sin tarjeta');
    expect(within(cambio).getByText('usuario 3 (consulta.demo); rol consulta → editor')).toBeInTheDocument();
    expect(within(cambio).queryByRole('link')).not.toBeInTheDocument();
  });

  it('un evento sin usuario (ingreso fallido) dice «Sin identificar»', async () => {
    montar();
    await esperarEventos();
    const fallido = screen.getByRole('heading', { level: 2, name: 'Ingreso fallido' }).closest('li');
    if (!fallido) throw new Error('sin tarjeta');
    expect(within(fallido).getByText('Sin identificar')).toBeInTheDocument();
  });

  it('una acción que la interfaz no conoce se muestra con su código: nunca se oculta un evento', async () => {
    montar({ extra: { 'GET /auditoria': () => respuestaJson(paginaDeEventos([eventoDePrueba(1, { accion: 'accion_futura' })])) } });
    expect(await screen.findByRole('heading', { level: 2, name: 'accion_futura' })).toBeInTheDocument();
  });

  it('el detalle se muestra como texto: una etiqueta HTML no se interpreta', async () => {
    montar({ extra: { 'GET /auditoria': () => respuestaJson(paginaDeEventos([eventoDePrueba(1, { detalle: '<b>negrita</b> <img src=x>' })])) } });
    expect(await screen.findByText('<b>negrita</b> <img src=x>')).toBeInTheDocument();
    expect(document.querySelector('main b')).toBeNull();
    expect(document.querySelector('main img')).toBeNull();
  });

  it('sin filtros pide la primera página de 20 y no manda ningún filtro', async () => {
    const api = montar();
    await esperarEventos();
    const consulta = ultimaConsulta(api);
    expect(consulta.get('pagina')).toBe('1');
    expect(consulta.get('tamano')).toBe('20');
    for (const filtro of ['usuarioId', 'accion', 'documentoId', 'desde', 'hasta']) expect(consulta.has(filtro)).toBe(false);
  });

  it('sin eventos lo dice; con filtros sugiere cambiarlos', async () => {
    const usuario = userEvent.setup();
    montar({ extra: { 'GET /auditoria': () => respuestaJson(paginaDeEventos([])) } });
    expect(await screen.findByText('Todavía no hay eventos registrados.')).toBeInTheDocument();
    await esperarUsuarios();
    await usuario.selectOptions(screen.getByLabelText('Acción'), 'carga');
    await usuario.click(boton('Filtrar'));
    expect(await screen.findByText(/Ningún evento coincide con los filtros/)).toBeInTheDocument();
    expect(screen.getByText('Sin eventos con estos filtros')).toBeInTheDocument();
  });

  it('«Actualizar» vuelve a consultar', async () => {
    const usuario = userEvent.setup();
    const api = montar();
    await esperarEventos();
    await usuario.click(boton('Actualizar'));
    await waitFor(() => expect(api.a('GET', '/auditoria')).toHaveLength(2));
  });

  it.each(['editor', 'consulta'] as const)('el rol %s no ve la pantalla y ni siquiera se le pide la auditoría', async (rol) => {
    const api = montar({ rol });
    expect(await screen.findByRole('heading', { name: /No tienes permiso/ })).toBeInTheDocument();
    expect(api.a('GET', '/auditoria')).toHaveLength(0);
    expect(api.a('GET', '/usuarios')).toHaveLength(0);
  });
});

describe('filtros', () => {
  it('filtra por usuario, acción, documento y fechas: la URL y la consulta llevan exactamente eso, con el día entero en hora de Colombia', async () => {
    const usuario = userEvent.setup();
    const api = montar();
    await esperarEventos();
    await esperarUsuarios();
    await usuario.selectOptions(screen.getByLabelText('Usuario'), '2');
    await usuario.selectOptions(screen.getByLabelText('Acción'), 'carga');
    await usuario.type(screen.getByLabelText('Número de documento'), '12');
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-11-22' } });
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-11-23' } });
    await usuario.click(boton('Filtrar'));

    await waitFor(() => expect(ubicacion()).toBe('/auditoria?usuarioId=2&accion=carga&documentoId=12&desde=2026-11-22&hasta=2026-11-23'));
    await waitFor(() => expect(ultimaConsulta(api).get('usuarioId')).toBe('2'));
    const consulta = ultimaConsulta(api);
    expect(consulta.get('accion')).toBe('carga');
    expect(consulta.get('documentoId')).toBe('12');
    // El 22 empieza a las 00:00 de Colombia (05:00 UTC) y el 23 termina a las 23:59:59,999 de Colombia (04:59:59,999 UTC del 24).
    expect(consulta.get('desde')).toBe('2026-11-22T05:00:00.000Z');
    expect(consulta.get('hasta')).toBe('2026-11-24T04:59:59.999Z');
    expect(consulta.get('pagina')).toBe('1');
  });

  it('con solo una fecha manda solo esa', async () => {
    const usuario = userEvent.setup();
    const api = montar();
    await esperarEventos();
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-11-23' } });
    await usuario.click(boton('Filtrar'));
    await waitFor(() => expect(ultimaConsulta(api).get('hasta')).toBe('2026-11-24T04:59:59.999Z'));
    expect(ultimaConsulta(api).has('desde')).toBe(false);
  });

  it('«desde» posterior a «hasta» no se envía: el error va en «Desde» y el foco también', async () => {
    const usuario = userEvent.setup();
    const api = montar();
    await esperarEventos();
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-11-23' } });
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-11-22' } });
    await usuario.click(boton('Filtrar'));
    expect(screen.getByLabelText('Desde')).toHaveAccessibleDescription(/La fecha «desde» no puede ser posterior a «hasta»/);
    expect(screen.getByLabelText('Desde')).toHaveFocus();
    expect(api.a('GET', '/auditoria')).toHaveLength(1);
    expect(ubicacion()).toBe('/auditoria');
  });

  it('un número de documento que no es un número no se envía', async () => {
    const usuario = userEvent.setup();
    const api = montar();
    await esperarEventos();
    await usuario.type(screen.getByLabelText('Número de documento'), 'doce');
    await usuario.click(boton('Filtrar'));
    expect(screen.getByLabelText('Número de documento')).toHaveAccessibleDescription(/Escribe solo el número del documento/);
    expect(screen.getByLabelText('Número de documento')).toHaveFocus();
    expect(api.a('GET', '/auditoria')).toHaveLength(1);
  });

  it('el 0 tampoco es un número de documento', async () => {
    const usuario = userEvent.setup();
    montar();
    await esperarEventos();
    await usuario.type(screen.getByLabelText('Número de documento'), '0');
    await usuario.click(boton('Filtrar'));
    expect(screen.getByLabelText('Número de documento')).toBeInvalid();
  });

  it('«Quitar filtros» vacía el formulario, la URL y la consulta', async () => {
    const usuario = userEvent.setup();
    const api = montar({ ruta: '/auditoria?accion=carga&documentoId=12&desde=2026-11-22' });
    await esperarEventos();
    expect(ultimaConsulta(api).get('accion')).toBe('carga');
    await usuario.click(boton('Quitar filtros'));
    await waitFor(() => expect(ubicacion()).toBe('/auditoria'));
    await waitFor(() => expect(ultimaConsulta(api).has('accion')).toBe(false));
    expect(screen.getByLabelText('Acción')).toHaveValue('');
    expect(screen.getByLabelText('Número de documento')).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Quitar filtros' })).not.toBeInTheDocument();
  });

  it('los filtros viven en la URL: al abrirla con filtros, el formulario y la consulta los traen', async () => {
    const api = montar({ ruta: '/auditoria?usuarioId=2&accion=descarga&documentoId=7&desde=2026-11-01&hasta=2026-11-30&pagina=2' });
    await esperarEventos();
    await esperarUsuarios();
    expect(screen.getByLabelText('Usuario')).toHaveValue('2');
    expect(screen.getByLabelText('Acción')).toHaveValue('descarga');
    expect(screen.getByLabelText('Número de documento')).toHaveValue('7');
    expect(screen.getByLabelText('Desde')).toHaveValue('2026-11-01');
    expect(screen.getByLabelText('Hasta')).toHaveValue('2026-11-30');
    const consulta = ultimaConsulta(api);
    expect(consulta.get('accion')).toBe('descarga');
    expect(consulta.get('pagina')).toBe('2');
    expect(screen.getByText('3 eventos con estos filtros')).toBeInTheDocument();
  });

  it('lo que la URL trae mal (acción inventada, fecha que no existe, número sin sentido) se descarta en vez de mandarlo a la API', async () => {
    const api = montar({ ruta: '/auditoria?accion=inventada&desde=2026-02-31&hasta=ayer&documentoId=abc&usuarioId=-1&pagina=0' });
    await esperarEventos();
    const consulta = ultimaConsulta(api);
    for (const filtro of ['usuarioId', 'accion', 'documentoId', 'desde', 'hasta']) expect(consulta.has(filtro)).toBe(false);
    expect(consulta.get('pagina')).toBe('1');
    expect(screen.queryByRole('button', { name: 'Quitar filtros' })).not.toBeInTheDocument();
  });

  it('el filtro de acción ofrece cada acción con su texto en español', async () => {
    montar();
    await esperarEventos();
    const selector = screen.getByLabelText('Acción');
    expect(within(selector).getByRole('option', { name: 'Todas las acciones' })).toBeInTheDocument();
    expect(within(selector).getByRole('option', { name: 'Decisión ante un duplicado' })).toHaveValue('decision_duplicado');
    expect(within(selector).getByRole('option', { name: 'Usuario desactivado' })).toHaveValue('usuario_desactivado');
    expect(within(selector).getAllByRole('option')).toHaveLength(15);
  });

  it('un usuario de la URL que no está en la lista (o no se pudo cargar) se ofrece como «Usuario n.º N»', async () => {
    montar({ ruta: '/auditoria?usuarioId=99' });
    await esperarEventos();
    await esperarUsuarios();
    const selector = screen.getByLabelText('Usuario');
    expect(selector).toHaveValue('99');
    expect(within(selector).getByRole('option', { name: 'Usuario n.º 99' })).toBeInTheDocument();
  });

  it('si no se pudo cargar la lista de usuarios lo avisa y el resto de la pantalla sigue sirviendo', async () => {
    montar({ extra: { 'GET /usuarios': () => respuestaJson({ message: 'boom' }, 500) } });
    await esperarEventos();
    expect(await screen.findByText(/No se pudo cargar la lista de usuarios/)).toBeInTheDocument();
    expect(within(screen.getByLabelText('Usuario')).getAllByRole('option')).toHaveLength(1);
  });

  it('marca como inactivos a los usuarios inactivos en el filtro', async () => {
    montar();
    await esperarEventos();
    expect(await screen.findByRole('option', { name: 'Persona Inactiva Demo (inactiva.demo) · inactivo' })).toBeInTheDocument();
  });
});

describe('paginación', () => {
  const pagina = (n: number) =>
    respuestaJson(paginaDeEventos([eventoDePrueba(100 - n, { accion: n === 1 ? 'carga' : 'descarga' })], { total: 45, pagina: n, tamano: 20 }));

  it('con 45 eventos hay 3 páginas: «Siguiente» cambia la URL y pide la página 2', async () => {
    const usuario = userEvent.setup();
    const api = montar({ extra: { 'GET /auditoria': (llamada) => pagina(Number(llamada.consulta.get('pagina') ?? 1)) } });
    await esperarEventos();
    expect(screen.getByText('Página 1 de 3')).toBeInTheDocument();
    expect(screen.getByText('45 eventos')).toBeInTheDocument();
    await usuario.click(boton('Siguiente'));
    await screen.findByRole('heading', { level: 2, name: 'Descarga de documento' });
    expect(ubicacion()).toBe('/auditoria?pagina=2');
    expect(ultimaConsulta(api).get('pagina')).toBe('2');
    expect(screen.getByText('Página 2 de 3')).toBeInTheDocument();
  });

  it('filtrar desde la página 3 vuelve a la página 1', async () => {
    const usuario = userEvent.setup();
    montar({ ruta: '/auditoria?pagina=3', extra: { 'GET /auditoria': (llamada) => pagina(Number(llamada.consulta.get('pagina') ?? 1)) } });
    await screen.findByText('Página 3 de 3');
    await usuario.selectOptions(screen.getByLabelText('Acción'), 'descarga');
    await usuario.click(boton('Filtrar'));
    await waitFor(() => expect(ubicacion()).toBe('/auditoria?accion=descarga'));
  });

  it('una página que no existe lleva a la última que sí', async () => {
    montar({
      ruta: '/auditoria?pagina=9',
      extra: {
        'GET /auditoria': (llamada) => {
          const n = Number(llamada.consulta.get('pagina') ?? 1);
          return n > 3 ? respuestaJson(paginaDeEventos([], { total: 45, pagina: n })) : pagina(n);
        },
      },
    });
    await screen.findByText('Página 3 de 3');
    expect(ubicacion()).toBe('/auditoria?pagina=3');
  });
});

describe('errores', () => {
  it('un 400 de la API se traduce a una frase y no muestra el texto del servidor', async () => {
    montar({
      extra: {
        'GET /auditoria': () =>
          respuestaJson({ statusCode: 400, message: 'Parámetros inválidos: desde: desde no puede ser posterior a hasta', problemas: ['desde: desde no puede ser posterior a hasta'] }, 400),
      },
    });
    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('La fecha «desde» no puede ser posterior a «hasta».');
    expect(alerta).not.toHaveTextContent('Parámetros inválidos');
  });

  it('un fallo del servidor muestra el aviso y deja reintentar', async () => {
    const usuario = userEvent.setup();
    let falla = true;
    montar({ extra: { 'GET /auditoria': () => (falla ? respuestaJson({ message: 'boom' }, 500) : respuestaJson(paginaDeEventos(EVENTOS))) } });
    expect(await screen.findByRole('alert')).toHaveTextContent('El servidor tuvo un problema');
    falla = false;
    await usuario.click(boton('Reintentar'));
    await esperarEventos();
  });

  it('un 429 dice cuánto esperar', async () => {
    montar({
      extra: {
        'GET /auditoria': () => respuestaJson({ statusCode: 429, message: 'Too Many Requests' }, 429, { 'Retry-After': '120' }),
      },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Intenta de nuevo en 2 minutos');
  });

  it('un 401 devuelve al ingreso con el aviso de sesión terminada', async () => {
    montar({ extra: { 'GET /auditoria': () => respuestaJson({ statusCode: 401, message: 'Se requiere iniciar sesión', error: 'Unauthorized' }, 401) } });
    expect(await screen.findByRole('heading', { name: 'Ingreso' })).toBeInTheDocument();
    expect(screen.getByText('Tu sesión terminó. Ingresa de nuevo para continuar.')).toBeInTheDocument();
  });

  it('un 403 de rol se explica y vuelve a leer la sesión: si el rol ya no sirve, muestra «sin permiso»', async () => {
    let consultas = 0;
    montar({
      extra: {
        'GET /auth/yo': () => {
          consultas += 1;
          return respuestaJson({ usuario: { id: 1, usuario: 'administrador.demo', nombre: 'Admin Demo', rol: consultas === 1 ? 'administrador' : 'consulta' } });
        },
        'GET /auditoria': () => respuestaJson({ statusCode: 403, message: 'Forbidden resource', error: 'Forbidden' }, 403),
      },
    });
    expect(await screen.findByRole('heading', { name: /No tienes permiso/ })).toBeInTheDocument();
    expect(consultas).toBe(2);
  });

  it('un 403 de origen se explica sin volver a leer la sesión', async () => {
    const api = montar({
      extra: { 'GET /auditoria': () => respuestaJson({ statusCode: 403, error: 'Forbidden', codigo: 'origen_no_permitido', message: 'Origen no permitido' }, 403) },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('desde un sitio que el servidor no reconoce');
    expect(api.a('GET', '/auth/yo')).toHaveLength(1);
  });
});
