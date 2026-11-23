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
} from '../pruebas/ayudas';

const LISTA_VACIA = { items: [], total: 0, pagina: 1, tamano: 10 };

function apiConSesion(rol: Parameters<typeof manejadoresDeSesion>[0], extra: Parameters<typeof simularApi>[0] = {}) {
  return simularApi({
    ...manejadoresDeSesion(rol),
    'GET /series': () => respuestaJson(CUADRO),
    'GET /documentos': () => respuestaJson(LISTA_VACIA),
    ...extra,
  });
}

const ubicacion = () => screen.getByTestId('ubicacion').textContent;

describe('guarda de rutas', () => {
  it('sin sesión, una ruta protegida lleva al ingreso', async () => {
    apiConSesion(null);
    renderizarApp('/documentos');
    expect(await screen.findByRole('heading', { name: 'Ingreso' })).toBeInTheDocument();
    expect(ubicacion()).toBe('/ingreso');
  });

  it('sin sesión, también las rutas de otros issues (nueva carga, usuarios, auditoría) llevan al ingreso', async () => {
    apiConSesion(null);
    for (const ruta of ['/documentos/nuevo', '/documentos/3/version', '/usuarios', '/auditoria', '/documentos/3']) {
      const { unmount } = renderizarApp(ruta);
      expect(await screen.findByRole('heading', { name: 'Ingreso' })).toBeInTheDocument();
      expect(ubicacion()).toBe('/ingreso');
      unmount();
    }
  });

  it('mientras se pregunta quién tiene la sesión no decide: ni ingreso ni contenido', async () => {
    let responder: (r: Response) => void = () => undefined;
    simularApi({
      'GET /auth/yo': () => new Promise<Response>((resolver) => (responder = resolver)),
      'GET /series': () => respuestaJson(CUADRO),
      'GET /documentos': () => respuestaJson(LISTA_VACIA),
    });
    renderizarApp('/documentos');
    expect(screen.getByText('Cargando…')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Ingreso' })).not.toBeInTheDocument();
    expect(ubicacion()).toBe('/documentos');

    responder(respuestaJson({ usuario: usuarioDePrueba('consulta') }));
    expect(await screen.findByRole('heading', { name: 'Documentos' })).toBeInTheDocument();
    expect(ubicacion()).toBe('/documentos');
  });

  it('con sesión deja pasar', async () => {
    apiConSesion('consulta');
    renderizarApp('/documentos');
    expect(await screen.findByRole('heading', { name: 'Documentos' })).toBeInTheDocument();
  });

  it('la raíz de la interfaz lleva a los documentos', async () => {
    apiConSesion('consulta');
    renderizarApp('/');
    expect(await screen.findByRole('heading', { name: 'Documentos' })).toBeInTheDocument();
    expect(ubicacion()).toBe('/documentos');
  });

  it('tras ingresar vuelve a la ruta que se quería abrir', async () => {
    const usuario = userEvent.setup();
    let conSesion = false;
    simularApi({
      ...manejadoresDeSesion('consulta'),
      'GET /auth/yo': () =>
        conSesion
          ? respuestaJson({ usuario: usuarioDePrueba('consulta') })
          : respuestaJson({ message: 'Se requiere iniciar sesión' }, 401),
      'POST /auth/login': () => {
        conSesion = true;
        return respuestaJson({ usuario: usuarioDePrueba('consulta') });
      },
      'GET /series': () => respuestaJson(CUADRO),
      'GET /documentos': () => respuestaJson(LISTA_VACIA),
    });
    renderizarApp('/documentos?q=acta&pagina=2');
    await screen.findByRole('heading', { name: 'Ingreso' });
    await usuario.type(screen.getByLabelText('Usuario'), 'consulta.demo');
    await usuario.type(screen.getByLabelText('Clave'), 'clave-demo-local-2026');
    await usuario.click(screen.getByRole('button', { name: 'Ingresar' }));
    expect(await screen.findByRole('heading', { name: 'Documentos' })).toBeInTheDocument();
    expect(ubicacion()).toBe('/documentos?q=acta&pagina=2');
  });

  describe('por rol', () => {
    it('consulta no ve la carga: pantalla de sin permiso', async () => {
      apiConSesion('consulta');
      renderizarApp('/documentos/nuevo');
      expect(await screen.findByRole('heading', { name: /No tienes permiso/ })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Cargar un documento' })).not.toBeInTheDocument();
    });

    it('consulta tampoco ve subir una versión', async () => {
      apiConSesion('consulta');
      renderizarApp('/documentos/3/version');
      expect(await screen.findByRole('heading', { name: /No tienes permiso/ })).toBeInTheDocument();
    });

    it.each(['editor', 'administrador'] as const)('%s sí llega al formulario de carga', async (rol) => {
      apiConSesion(rol);
      renderizarApp('/documentos/nuevo');
      expect(await screen.findByRole('heading', { level: 1, name: 'Cargar un documento' })).toBeInTheDocument();
      expect(screen.getByLabelText(/Título/)).toBeInTheDocument();
    });

    it.each(['consulta', 'editor'] as const)('%s no ve usuarios ni auditoría', async (rol) => {
      apiConSesion(rol);
      const primera = renderizarApp('/usuarios');
      expect(await screen.findByRole('heading', { name: /No tienes permiso/ })).toBeInTheDocument();
      primera.unmount();
      renderizarApp('/auditoria');
      expect(await screen.findByRole('heading', { name: /No tienes permiso/ })).toBeInTheDocument();
    });

    it('el administrador llega a usuarios y a auditoría (pantallas marcador del #25)', async () => {
      apiConSesion('administrador');
      const primera = renderizarApp('/usuarios');
      expect(await screen.findByRole('heading', { name: 'Usuarios' })).toBeInTheDocument();
      expect(screen.getByText(/issue #25/)).toBeInTheDocument();
      primera.unmount();
      renderizarApp('/auditoria');
      expect(await screen.findByRole('heading', { name: 'Auditoría' })).toBeInTheDocument();
    });
  });

  it('una dirección que no es una pantalla muestra «no existe», con o sin sesión', async () => {
    apiConSesion(null);
    renderizarApp('/no-existe');
    expect(await screen.findByRole('heading', { name: 'Esta página no existe' })).toBeInTheDocument();
  });

  describe('sesión que termina mientras se usa', () => {
    it('un 401 de la API devuelve al ingreso con un aviso', async () => {
      const usuario = userEvent.setup();
      let vencida = false;
      simularApi({
        ...manejadoresDeSesion('consulta'),
        'GET /series': () => respuestaJson(CUADRO),
        'GET /documentos': () =>
          vencida
            ? respuestaJson({ statusCode: 401, message: 'Se requiere iniciar sesión' }, 401)
            : respuestaJson({ ...LISTA_VACIA, total: 25, items: [{ id: 1, titulo: 'Acta uno', expediente: 'E-1', serieId: 11, serieCodigo: '100-01', fechaDocumento: '2026-03-15', creadoPor: 1, creadoEn: '2026-11-20T15:30:00.000Z', versionActual: 1 }] }),
      });
      renderizarApp('/documentos');
      await screen.findByText('Acta uno');
      vencida = true;
      await usuario.click(screen.getByRole('button', { name: 'Siguiente' }));
      expect(await screen.findByRole('heading', { name: 'Ingreso' })).toBeInTheDocument();
      expect(screen.getByText(/Tu sesión terminó/)).toBeInTheDocument();
      await waitFor(() => expect(ubicacion()).toBe('/ingreso'));
    });
  });
});
