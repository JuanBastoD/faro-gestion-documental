import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  CUADRO,
  manejadoresDeSesion,
  renderizarApp,
  respuestaJson,
  simularApi,
  usuarioDePrueba,
  type Manejador,
} from '../pruebas/ayudas';

const ubicacion = () => screen.getByTestId('ubicacion').textContent;

const SIN_SESION = respuestaJson({ message: 'Se requiere iniciar sesión' }, 401);

function montarIngreso(login: Manejador) {
  const api = simularApi({
    'GET /auth/yo': () => SIN_SESION.clone(),
    'POST /auth/login': login,
    'GET /series': () => respuestaJson(CUADRO),
    'GET /documentos': () => respuestaJson({ items: [], total: 0, pagina: 1, tamano: 10 }),
    'POST /auth/logout': () => new Response(null, { status: 204 }),
  });
  renderizarApp('/ingreso');
  return api;
}

async function escribirCredenciales(usuario: ReturnType<typeof userEvent.setup>, nombre = 'ana.demo', clave = 'clave-incorrecta') {
  await usuario.type(await screen.findByLabelText('Usuario'), nombre);
  await usuario.type(screen.getByLabelText('Clave'), clave);
}

describe('formulario de ingreso', () => {
  it('tiene etiquetas, y el botón no se activa hasta llenar usuario y clave', async () => {
    const usuario = userEvent.setup();
    montarIngreso(() => respuestaJson({}, 500));
    const boton = await screen.findByRole('button', { name: 'Ingresar' });
    expect(screen.getByLabelText('Usuario')).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByLabelText('Clave')).toHaveAttribute('type', 'password');
    expect(boton).toBeDisabled();
    await usuario.type(screen.getByLabelText('Usuario'), 'ana');
    expect(boton).toBeDisabled();
    await usuario.type(screen.getByLabelText('Clave'), 'x');
    expect(boton).toBeEnabled();
  });

  it('ingreso correcto: manda usuario y clave, abre la sesión y lleva a los documentos', async () => {
    const usuario = userEvent.setup();
    const api = montarIngreso(() => respuestaJson({ usuario: usuarioDePrueba('editor') }));
    await escribirCredenciales(usuario, '  editor.demo ', 'clave-demo-local-2026');
    await usuario.click(screen.getByRole('button', { name: 'Ingresar' }));

    expect(await screen.findByRole('heading', { name: 'Documentos' })).toBeInTheDocument();
    expect(ubicacion()).toBe('/documentos');
    // El usuario se manda sin los espacios de los lados; la clave, tal cual.
    expect(api.a('POST', '/auth/login')[0].cuerpo).toEqual({ usuario: 'editor.demo', clave: 'clave-demo-local-2026' });
    expect(screen.getByText('Editor Demo')).toBeInTheDocument();
  });

  it('401: muestra el mensaje de la API, vacía la clave y deja reintentar', async () => {
    const usuario = userEvent.setup();
    montarIngreso(() => respuestaJson({ statusCode: 401, message: 'Usuario o clave incorrectos', error: 'Unauthorized' }, 401));
    await escribirCredenciales(usuario);
    await usuario.click(screen.getByRole('button', { name: 'Ingresar' }));

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('Usuario o clave incorrectos');
    expect(ubicacion()).toBe('/ingreso');
    expect(screen.getByLabelText('Clave')).toHaveValue('');
    expect(screen.getByLabelText('Usuario')).toHaveValue('ana.demo');
    expect(screen.getByLabelText('Clave')).toHaveAccessibleDescription('Usuario o clave incorrectos');
    // No es una sesión vencida: no hay aviso de «tu sesión terminó».
    expect(screen.queryByText(/Tu sesión terminó/)).not.toBeInTheDocument();
  });

  it('un nuevo intento borra el error anterior', async () => {
    const usuario = userEvent.setup();
    let correcto = false;
    montarIngreso(() =>
      correcto ? respuestaJson({ usuario: usuarioDePrueba('consulta') }) : respuestaJson({ message: 'Usuario o clave incorrectos' }, 401),
    );
    await escribirCredenciales(usuario);
    await usuario.click(screen.getByRole('button', { name: 'Ingresar' }));
    await screen.findByRole('alert');

    correcto = true;
    await usuario.type(screen.getByLabelText('Clave'), 'otra');
    await usuario.click(screen.getByRole('button', { name: 'Ingresar' }));
    expect(await screen.findByRole('heading', { name: 'Documentos' })).toBeInTheDocument();
  });

  it('429: dice cuánto esperar según Retry-After (10 minutos)', async () => {
    const usuario = userEvent.setup();
    montarIngreso(() =>
      respuestaJson(
        { statusCode: 429, error: 'Too Many Requests', codigo: 'demasiados_intentos', message: 'Demasiados intentos de ingreso. Intenta de nuevo en 15 minutos.' },
        429,
        { 'Retry-After': '600' },
      ),
    );
    await escribirCredenciales(usuario);
    await usuario.click(screen.getByRole('button', { name: 'Ingresar' }));
    const alerta = await screen.findByRole('alert');
    // El tiempo sale de la cabecera Retry-After (600 s), no del texto del servidor (que decía 15).
    expect(alerta).toHaveTextContent('Demasiados intentos de ingreso. Intenta de nuevo en 10 minutos.');
    expect(ubicacion()).toBe('/ingreso');
  });

  it('429 con menos de un minuto: lo dice en segundos', async () => {
    const usuario = userEvent.setup();
    montarIngreso(() => respuestaJson({ message: 'x' }, 429, { 'Retry-After': '42' }));
    await escribirCredenciales(usuario);
    await usuario.click(screen.getByRole('button', { name: 'Ingresar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Intenta de nuevo en 42 segundos.');
  });

  it('429 sin Retry-After: mensaje general', async () => {
    const usuario = userEvent.setup();
    montarIngreso(() => respuestaJson({ message: 'x' }, 429));
    await escribirCredenciales(usuario);
    await usuario.click(screen.getByRole('button', { name: 'Ingresar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Demasiados intentos');
  });

  it('403 de origen no permitido: muestra el mensaje de la API', async () => {
    const usuario = userEvent.setup();
    montarIngreso(() =>
      respuestaJson({ statusCode: 403, error: 'Forbidden', codigo: 'origen_no_permitido', message: 'La petición viene de un origen no permitido' }, 403),
    );
    await escribirCredenciales(usuario);
    await usuario.click(screen.getByRole('button', { name: 'Ingresar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('La petición viene de un origen no permitido');
  });

  it('sin conexión: mensaje de red y el formulario sigue disponible', async () => {
    const usuario = userEvent.setup();
    montarIngreso(() => {
      throw new TypeError('Failed to fetch');
    });
    await escribirCredenciales(usuario);
    await usuario.click(screen.getByRole('button', { name: 'Ingresar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo conectar con el servidor');
    expect(screen.getByLabelText('Usuario')).toBeEnabled();
  });

  it('mientras envía no permite enviar dos veces', async () => {
    const usuario = userEvent.setup();
    let soltar: (r: Response) => void = () => undefined;
    const api = montarIngreso(() => new Promise<Response>((resolver) => (soltar = resolver)));
    await escribirCredenciales(usuario);
    await usuario.click(screen.getByRole('button', { name: 'Ingresar' }));
    const boton = await screen.findByRole('button', { name: 'Ingresando…' });
    expect(boton).toBeDisabled();
    await usuario.click(boton);
    expect(api.a('POST', '/auth/login')).toHaveLength(1);
    soltar(respuestaJson({ usuario: usuarioDePrueba('consulta') }));
    expect(await screen.findByRole('heading', { name: 'Documentos' })).toBeInTheDocument();
  });

  it('quien ya tiene sesión no ve el ingreso: pasa a los documentos', async () => {
    simularApi({
      ...manejadoresDeSesion('consulta'),
      'GET /series': () => respuestaJson(CUADRO),
      'GET /documentos': () => respuestaJson({ items: [], total: 0, pagina: 1, tamano: 10 }),
    });
    renderizarApp('/ingreso');
    expect(await screen.findByRole('heading', { name: 'Documentos' })).toBeInTheDocument();
    expect(ubicacion()).toBe('/documentos');
  });
});

describe('cierre de sesión', () => {
  it('«Cerrar sesión» avisa a la API y vuelve al ingreso', async () => {
    const usuario = userEvent.setup();
    const api = simularApi({
      ...manejadoresDeSesion('consulta'),
      'GET /series': () => respuestaJson(CUADRO),
      'GET /documentos': () => respuestaJson({ items: [], total: 0, pagina: 1, tamano: 10 }),
    });
    renderizarApp('/documentos');
    await usuario.click(await screen.findByRole('button', { name: 'Cerrar sesión' }));
    expect(await screen.findByRole('heading', { name: 'Ingreso' })).toBeInTheDocument();
    expect(api.a('POST', '/auth/logout')).toHaveLength(1);
    expect(ubicacion()).toBe('/ingreso');
    // Salir a propósito no es una sesión vencida: sin aviso.
    expect(screen.queryByText(/Tu sesión terminó/)).not.toBeInTheDocument();
  });

  it('aunque el servidor no conteste, la interfaz sale', async () => {
    const usuario = userEvent.setup();
    simularApi({
      ...manejadoresDeSesion('consulta'),
      'POST /auth/logout': () => {
        throw new TypeError('Failed to fetch');
      },
      'GET /series': () => respuestaJson(CUADRO),
      'GET /documentos': () => respuestaJson({ items: [], total: 0, pagina: 1, tamano: 10 }),
    });
    renderizarApp('/documentos');
    await usuario.click(await screen.findByRole('button', { name: 'Cerrar sesión' }));
    await waitFor(() => expect(ubicacion()).toBe('/ingreso'));
  });
});
