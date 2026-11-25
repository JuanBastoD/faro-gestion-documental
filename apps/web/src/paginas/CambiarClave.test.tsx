import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Rol } from '../api/auth';
import {
  CUADRO,
  manejadoresDeSesion,
  renderizarApp,
  respuestaJson,
  simularApi,
  usuarioDePrueba,
} from '../pruebas/ayudas';

type Manejadores = Parameters<typeof simularApi>[0];
type Usuario = ReturnType<typeof userEvent.setup>;

const LISTA_VACIA = { items: [], total: 0, pagina: 1, tamano: 10 };

// Constantes de baja entropía a propósito: son datos de prueba, no claves (el escáner de secretos las ignora).
const CLAVE_ACTUAL = 'x'.repeat(14);
const CLAVE_NUEVA = 'y'.repeat(14);

function montar(opciones: { forzada?: boolean; rol?: Rol; ruta?: Parameters<typeof renderizarApp>[0]; extra?: Manejadores } = {}) {
  const api = simularApi({
    ...manejadoresDeSesion(opciones.rol ?? 'editor', opciones.forzada ? { debeCambiarClave: true } : {}),
    'GET /series': () => respuestaJson(CUADRO),
    'GET /documentos': () => respuestaJson(LISTA_VACIA),
    'POST /auth/clave': () => new Response(null, { status: 204 }),
    ...opciones.extra,
  });
  renderizarApp(opciones.ruta ?? '/clave');
  return api;
}

const ubicacion = () => screen.getByTestId('ubicacion').textContent;
const estadoDeUbicacion = () => JSON.parse(screen.getByTestId('ubicacion').dataset.estado ?? 'null') as { desde?: string } | null;
const campo = (etiqueta: RegExp) => screen.getByLabelText(etiqueta);
const enviar = (usuario: Usuario) => usuario.click(screen.getByRole('button', { name: 'Cambiar mi clave' }));

async function escribir(usuario: Usuario, etiqueta: RegExp, valor: string) {
  await usuario.click(campo(etiqueta));
  await usuario.paste(valor);
}

async function llenar(usuario: Usuario, nueva = CLAVE_NUEVA, repetida = nueva) {
  await escribir(usuario, /^Clave actual/, CLAVE_ACTUAL);
  await escribir(usuario, /^Clave nueva/, nueva);
  await escribir(usuario, /^Repite la clave nueva/, repetida);
}

async function esperarPantalla() {
  await screen.findByRole('heading', { level: 1, name: 'Cambiar mi clave' });
}

describe('cambiar mi clave (voluntario)', () => {
  it('se abre desde «Mi clave» del menú y explica qué pasa con las demás sesiones', async () => {
    const usuario = userEvent.setup();
    montar({ ruta: '/documentos' });
    await screen.findByRole('heading', { level: 1, name: 'Documentos' });
    await usuario.click(within(screen.getByRole('navigation', { name: 'Principal' })).getByRole('link', { name: 'Mi clave' }));
    await esperarPantalla();
    expect(ubicacion()).toBe('/clave');
    expect(screen.getByText(/demás sesiones abiertas con tu usuario/)).toBeInTheDocument();
    expect(screen.queryByText(/Tu clave es temporal/)).not.toBeInTheDocument();
  });

  it('las tres claves se escriben ocultas y hay una casilla para verlas', async () => {
    const usuario = userEvent.setup();
    montar();
    await esperarPantalla();
    for (const etiqueta of [/^Clave actual/, /^Clave nueva/, /^Repite la clave nueva/]) expect(campo(etiqueta)).toHaveAttribute('type', 'password');
    expect(campo(/^Clave actual/)).toHaveAttribute('autocomplete', 'current-password');
    expect(campo(/^Clave nueva/)).toHaveAttribute('autocomplete', 'new-password');
    await usuario.click(screen.getByLabelText('Mostrar las claves mientras las escribo'));
    for (const etiqueta of [/^Clave actual/, /^Clave nueva/, /^Repite la clave nueva/]) expect(campo(etiqueta)).toHaveAttribute('type', 'text');
  });

  it('con todo vacío señala los tres campos, pone el foco en el primero y no envía nada', async () => {
    const usuario = userEvent.setup();
    const api = montar();
    await esperarPantalla();
    await enviar(usuario);
    expect(screen.getByText('Escribe tu clave actual.')).toBeInTheDocument();
    expect(screen.getByText('Escribe la clave nueva.')).toBeInTheDocument();
    expect(screen.getByText('Vuelve a escribir la clave nueva para confirmarla.')).toBeInTheDocument();
    expect(campo(/^Clave actual/)).toHaveFocus();
    expect(campo(/^Clave actual/)).toHaveAttribute('aria-invalid', 'true');
    expect(api.a('POST', '/auth/clave')).toHaveLength(0);
  });

  it('una clave nueva de 11 caracteres no se envía', async () => {
    const usuario = userEvent.setup();
    const api = montar();
    await esperarPantalla();
    await llenar(usuario, 'y'.repeat(11));
    await enviar(usuario);
    expect(screen.getByText(/Mínimo 12 caracteres: esta tiene 11/)).toBeInTheDocument();
    expect(campo(/^Clave nueva/)).toHaveFocus();
    expect(api.a('POST', '/auth/clave')).toHaveLength(0);
  });

  it('una clave nueva igual a la actual no se envía', async () => {
    const usuario = userEvent.setup();
    const api = montar();
    await esperarPantalla();
    await llenar(usuario, CLAVE_ACTUAL);
    await enviar(usuario);
    expect(screen.getByText('La clave nueva debe ser distinta de la actual.')).toBeInTheDocument();
    expect(api.a('POST', '/auth/clave')).toHaveLength(0);
  });

  it('una repetición que no coincide no se envía', async () => {
    const usuario = userEvent.setup();
    const api = montar();
    await esperarPantalla();
    await llenar(usuario, CLAVE_NUEVA, `${CLAVE_NUEVA}z`);
    await enviar(usuario);
    expect(screen.getByText(/No coincide con la clave nueva/)).toBeInTheDocument();
    expect(campo(/^Repite la clave nueva/)).toHaveFocus();
    expect(api.a('POST', '/auth/clave')).toHaveLength(0);
  });

  it('cambia la clave: envía solo claveActual y claveNueva, avisa con el foco en el aviso y no deja la clave en la pantalla', async () => {
    const usuario = userEvent.setup();
    const api = montar({ ruta: { pathname: '/clave', state: { desde: '/documentos?q=acta' } } });
    await esperarPantalla();
    await llenar(usuario);
    await enviar(usuario);

    const aviso = await screen.findByText(/Tu clave cambió/);
    expect(aviso).toHaveFocus();
    expect(aviso).toHaveTextContent('Las demás sesiones abiertas con tu usuario se cerraron; esta sigue abierta.');
    expect(api.a('POST', '/auth/clave')).toHaveLength(1);
    expect(api.a('POST', '/auth/clave')[0].cuerpo).toEqual({ claveActual: CLAVE_ACTUAL, claveNueva: CLAVE_NUEVA });
    // Las claves ya no están: ni el formulario, ni sus valores, ni el texto de la página.
    expect(screen.queryByLabelText(/^Clave actual/)).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(CLAVE_NUEVA);
    expect(document.body.innerHTML).not.toContain(CLAVE_ACTUAL);
    expect(ubicacion()).toBe('/clave');
    expect(JSON.stringify(window.history.state ?? null)).not.toContain(CLAVE_NUEVA);
    expect(screen.getByRole('link', { name: 'Volver' })).toHaveAttribute('href', '/documentos?q=acta');
  });

  it('la clave actual equivocada (400 clave_actual_incorrecta) es un error del campo: foco allí, lo escrito se conserva y no es una sesión vencida', async () => {
    const usuario = userEvent.setup();
    const api = montar({
      extra: {
        'POST /auth/clave': () =>
          respuestaJson({ statusCode: 400, error: 'Bad Request', codigo: 'clave_actual_incorrecta', message: 'La clave actual no es correcta' }, 400),
      },
    });
    await esperarPantalla();
    await llenar(usuario);
    await enviar(usuario);

    expect(await screen.findByText(/La clave actual no es correcta/)).toBeInTheDocument();
    await waitFor(() => expect(campo(/^Clave actual/)).toHaveFocus());
    expect(campo(/^Clave actual/)).toHaveAttribute('aria-invalid', 'true');
    expect(campo(/^Clave actual/)).toHaveValue(CLAVE_ACTUAL);
    expect(campo(/^Clave nueva/)).toHaveValue(CLAVE_NUEVA);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/Tu sesión terminó/)).not.toBeInTheDocument();
    expect(ubicacion()).toBe('/clave');
    expect(api.a('GET', '/auth/yo')).toHaveLength(1);
  });

  it('un 400 con problemas va al campo que corresponde', async () => {
    const usuario = userEvent.setup();
    montar({
      extra: {
        'POST /auth/clave': () => respuestaJson({ message: 'Datos no válidos', problemas: ['claveNueva: debe ser distinta de la clave actual'] }, 400),
      },
    });
    await esperarPantalla();
    await llenar(usuario);
    await enviar(usuario);
    expect(await screen.findByText('La clave nueva debe ser distinta de la actual.')).toBeInTheDocument();
    await waitFor(() => expect(campo(/^Clave nueva/)).toHaveFocus());
  });

  it('un 429 dice cuánto esperar según Retry-After, con el foco en la alerta', async () => {
    const usuario = userEvent.setup();
    montar({
      extra: { 'POST /auth/clave': () => respuestaJson({ codigo: 'demasiados_intentos', message: 'x' }, 429, { 'Retry-After': '900' }) },
    });
    await esperarPantalla();
    await llenar(usuario);
    await enviar(usuario);
    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('Intenta de nuevo en 15 minutos');
    expect(alerta).toHaveTextContent('tampoco podrás ingresar');
    await waitFor(() => expect(alerta).toHaveFocus());
    expect(campo(/^Clave actual/)).toHaveValue(CLAVE_ACTUAL);
  });

  it('un 409 conflicto_de_clave se explica y deja intentar de nuevo', async () => {
    const usuario = userEvent.setup();
    montar({ extra: { 'POST /auth/clave': () => respuestaJson({ codigo: 'conflicto_de_clave', message: 'x' }, 409) } });
    await esperarPantalla();
    await llenar(usuario);
    await enviar(usuario);
    expect(await screen.findByRole('alert')).toHaveTextContent('Otra petición cambió tu clave al mismo tiempo');
    expect(screen.getByRole('button', { name: 'Cambiar mi clave' })).toBeEnabled();
  });

  it('sin conexión avisa que, si la clave sí cambió, la anterior ya no sirve', async () => {
    const usuario = userEvent.setup();
    montar({ extra: { 'POST /auth/clave': () => Promise.reject(new TypeError('Failed to fetch')) } });
    await esperarPantalla();
    await llenar(usuario);
    await enviar(usuario);
    expect(await screen.findByRole('alert')).toHaveTextContent('la anterior ya no sirve');
  });

  it('un fallo del servidor muestra el texto propio y deja repetir', async () => {
    const usuario = userEvent.setup();
    montar({ extra: { 'POST /auth/clave': () => respuestaJson({ message: 'boom interno' }, 500) } });
    await esperarPantalla();
    await llenar(usuario);
    await enviar(usuario);
    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('El servidor tuvo un problema');
    expect(alerta).not.toHaveTextContent('boom interno');
  });

  it('un 401 (la sesión terminó) lleva al ingreso con el aviso', async () => {
    const usuario = userEvent.setup();
    montar({ extra: { 'POST /auth/clave': () => respuestaJson({ message: 'Se requiere iniciar sesión' }, 401) } });
    await esperarPantalla();
    await llenar(usuario);
    await enviar(usuario);
    expect(await screen.findByRole('heading', { name: 'Ingreso' })).toBeInTheDocument();
    expect(screen.getByText('Tu sesión terminó. Ingresa de nuevo para continuar.')).toBeInTheDocument();
  });

  it('un segundo envío mientras se cambia no manda otra petición', async () => {
    const usuario = userEvent.setup();
    let liberar: (r: Response) => void = () => undefined;
    const api = montar({ extra: { 'POST /auth/clave': () => new Promise<Response>((resolver) => (liberar = resolver)) } });
    await esperarPantalla();
    await llenar(usuario);
    await enviar(usuario);
    expect(await screen.findByRole('button', { name: 'Cambiando la clave…' })).toBeDisabled();
    await usuario.keyboard('{Enter}');
    expect(api.a('POST', '/auth/clave')).toHaveLength(1);
    liberar(new Response(null, { status: 204 }));
    await screen.findByText(/Tu clave cambió/);
    expect(api.a('POST', '/auth/clave')).toHaveLength(1);
  });
});

describe('cambio de clave obligatorio (clave temporal)', () => {
  it('con debeCambiarClave cualquier ruta lleva a /clave y recuerda a dónde se iba', async () => {
    const api = montar({ forzada: true, ruta: '/documentos?q=acta&pagina=2' });
    await esperarPantalla();
    expect(ubicacion()).toBe('/clave');
    expect(estadoDeUbicacion()).toEqual({ desde: '/documentos?q=acta&pagina=2' });
    // La pantalla que se quería abrir ni siquiera pidió sus datos.
    expect(api.a('GET', '/documentos')).toHaveLength(0);
    expect(api.a('GET', '/series')).toHaveLength(0);
  });

  it.each(['/documentos/3', '/documentos/nuevo', '/documentos/3/version', '/usuarios', '/auditoria'])('%s también lleva a /clave', async (ruta) => {
    montar({ forzada: true, rol: 'administrador', ruta });
    await esperarPantalla();
    expect(ubicacion()).toBe('/clave');
    expect(estadoDeUbicacion()).toEqual({ desde: ruta });
  });

  it('no hay menú: solo la marca, quién eres y «Cerrar sesión»; el aviso dice que la clave es temporal', async () => {
    montar({ forzada: true, ruta: '/documentos' });
    await esperarPantalla();
    expect(screen.queryByRole('navigation', { name: 'Principal' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeInTheDocument();
    expect(screen.getByText('Editor Demo')).toBeInTheDocument();
    expect(screen.getByText(/Tu clave es temporal\./)).toBeInTheDocument();
    expect(screen.getByText('La clave temporal que te entregó el administrador.')).toBeInTheDocument();
  });

  it('al cambiarla vuelve el menú y «Continuar» lleva a donde se iba', async () => {
    const usuario = userEvent.setup();
    const api = montar({ forzada: true, ruta: '/documentos?q=acta' });
    await esperarPantalla();
    await llenar(usuario);
    await enviar(usuario);
    await screen.findByText(/Tu clave cambió/);
    expect(screen.getByRole('navigation', { name: 'Principal' })).toBeInTheDocument();
    expect(api.a('GET', '/documentos')).toHaveLength(0);

    await usuario.click(screen.getByRole('link', { name: 'Continuar' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Documentos' })).toBeInTheDocument();
    expect(ubicacion()).toBe('/documentos?q=acta');
    expect(api.a('GET', '/documentos').length).toBeGreaterThan(0);
  });

  it('un 403 cambio_de_clave_requerido de cualquier pantalla lleva a /clave aunque la sesión no lo dijera', async () => {
    montar({
      ruta: '/documentos',
      extra: {
        'GET /documentos': () =>
          respuestaJson({ statusCode: 403, error: 'Forbidden', codigo: 'cambio_de_clave_requerido', message: 'Debes cambiar la clave temporal antes de continuar' }, 403),
      },
    });
    await esperarPantalla();
    expect(ubicacion()).toBe('/clave');
    expect(screen.getByText(/Tu clave es temporal\./)).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Principal' })).not.toBeInTheDocument();
  });

  it('un 403 de rol (sin código) no lleva a cambiar la clave', async () => {
    montar({
      ruta: '/documentos',
      extra: { 'GET /documentos': () => respuestaJson({ statusCode: 403, message: 'No tienes permiso' }, 403) },
    });
    await screen.findByRole('heading', { level: 1, name: 'Documentos' });
    expect(ubicacion()).toBe('/documentos');
  });

  it('«Cerrar sesión» desde esta pantalla lleva al ingreso', async () => {
    const usuario = userEvent.setup();
    montar({ forzada: true, ruta: '/documentos' });
    await esperarPantalla();
    await usuario.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
    expect(await screen.findByRole('heading', { name: 'Ingreso' })).toBeInTheDocument();
  });

  it('al ingresar con una clave temporal el ingreso lleva directo a cambiarla', async () => {
    const usuario = userEvent.setup();
    let conSesion = false;
    const forzado = usuarioDePrueba('editor', { debeCambiarClave: true });
    simularApi({
      'GET /auth/yo': () => (conSesion ? respuestaJson({ usuario: forzado }) : respuestaJson({ message: 'Se requiere iniciar sesión' }, 401)),
      'POST /auth/login': () => {
        conSesion = true;
        return respuestaJson({ usuario: forzado });
      },
      'GET /series': () => respuestaJson(CUADRO),
      'GET /documentos': () => respuestaJson(LISTA_VACIA),
    });
    renderizarApp('/documentos');
    await screen.findByRole('heading', { name: 'Ingreso' });
    await usuario.type(screen.getByLabelText('Usuario'), 'editor.demo');
    await usuario.type(screen.getByLabelText('Clave'), 'clave-temporal-de-prueba');
    await usuario.click(screen.getByRole('button', { name: 'Ingresar' }));
    await esperarPantalla();
    expect(ubicacion()).toBe('/clave');
    expect(screen.getByText(/Tu clave es temporal\./)).toBeInTheDocument();
  });

  it('si la API no manda debeCambiarClave (anterior a #57) no hay redirección ni menú de menos', async () => {
    montar({ ruta: '/documentos' });
    await screen.findByRole('heading', { level: 1, name: 'Documentos' });
    expect(ubicacion()).toBe('/documentos');
    expect(screen.getByRole('navigation', { name: 'Principal' })).toBeInTheDocument();
  });

  it('con debeCambiarClave en false tampoco se redirige', async () => {
    simularApi({
      ...manejadoresDeSesion('editor', { debeCambiarClave: false }),
      'GET /series': () => respuestaJson(CUADRO),
      'GET /documentos': () => respuestaJson(LISTA_VACIA),
    });
    renderizarApp('/documentos');
    await screen.findByRole('heading', { level: 1, name: 'Documentos' });
    expect(ubicacion()).toBe('/documentos');
  });
});
