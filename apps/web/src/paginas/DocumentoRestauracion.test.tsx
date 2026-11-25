import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { DocumentoConVersiones, VersionDetalle } from '../api/documentos';
import {
  CUADRO,
  documentoDePrueba,
  manejadoresDeSesion,
  renderizarApp,
  respuestaJson,
  simularApi,
  type Manejador,
} from '../pruebas/ayudas';
import { versionDePrueba } from '../pruebas/carga';

function documentoConVersiones(versiones: VersionDetalle[]): DocumentoConVersiones {
  const { versionActual: _quitada, ...documento } = documentoDePrueba(12, { titulo: 'Acta de comité 12' });
  return { ...documento, versiones };
}

describe('aviso de la pantalla anterior en el detalle', () => {
  it('muestra el aviso que llega por la navegación, con el foco, y lo borra de la historia', async () => {
    simularApi({
      ...manejadoresDeSesion('editor'),
      'GET /series': () => respuestaJson(CUADRO),
      'GET /documentos/12': () => respuestaJson(documentoConVersiones([versionDePrueba(2), versionDePrueba(1)])),
    });
    renderizarApp({ pathname: '/documentos/12', state: { aviso: 'Se agregó la versión 2 de «Acta de comité 12».' } });
    const aviso = await screen.findByText('Se agregó la versión 2 de «Acta de comité 12».');
    expect(aviso).toHaveFocus();
    // El aviso queda en la pantalla, pero ya no en la historia: al recargar no reaparecería.
    await waitFor(() => expect(screen.getByTestId('ubicacion')).toHaveAttribute('data-estado', 'null'));
    expect(screen.getByText('Se agregó la versión 2 de «Acta de comité 12».')).toBeInTheDocument();
  });

  it('sin aviso, no muestra nada', async () => {
    simularApi({
      ...manejadoresDeSesion('editor'),
      'GET /series': () => respuestaJson(CUADRO),
      'GET /documentos/12': () => respuestaJson(documentoConVersiones([versionDePrueba(1)])),
    });
    renderizarApp('/documentos/12');
    await screen.findByRole('heading', { level: 1, name: 'Acta de comité 12' });
    expect(screen.queryByText(/Se agregó/)).not.toBeInTheDocument();
  });
});

describe('restaurar una versión anterior', () => {
  const tres = [versionDePrueba(3), versionDePrueba(2), versionDePrueba(1)];

  function montar(
    rol: 'consulta' | 'editor' | 'administrador',
    restaurar: Manejador = () => respuestaJson(versionDePrueba(4, { restauradaDe: 1 }), 201),
  ) {
    let restaurada = false;
    const api = simularApi({
      ...manejadoresDeSesion(rol),
      'GET /series': () => respuestaJson(CUADRO),
      'GET /documentos/12': () =>
        respuestaJson(
          documentoConVersiones(
            restaurada ? [versionDePrueba(4, { restauradaDe: 1, motivo: 'Restaura la versión 1' }), ...tres] : tres,
          ),
        ),
      'POST /documentos/12/versiones/1/restaurar': async (llamada) => {
        const respuesta = await restaurar(llamada);
        if (respuesta.status === 201) restaurada = true;
        return respuesta;
      },
    });
    renderizarApp('/documentos/12');
    return api;
  }

  const restaurar = (numero: number) => screen.getByRole('button', { name: `Restaurar la versión ${numero}` });
  const confirmar = () => screen.getByRole('button', { name: 'Sí, restaurar la versión 1' });

  it('editor y administrador ven «Restaurar» en las versiones anteriores, no en la vigente', async () => {
    montar('editor');
    await screen.findByRole('heading', { name: 'Historial de versiones' });
    expect(restaurar(1)).toBeInTheDocument();
    expect(restaurar(2)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restaurar la versión 3' })).not.toBeInTheDocument();
  });

  it('el rol de consulta no ve ninguna acción de restaurar', async () => {
    montar('consulta');
    await screen.findByRole('heading', { name: 'Historial de versiones' });
    expect(screen.queryByRole('button', { name: /Restaurar/ })).not.toBeInTheDocument();
  });

  it('abrir la confirmación no envía nada y explica que se crea una versión nueva y no se borra nada', async () => {
    const usuario = userEvent.setup();
    const api = montar('editor');
    await screen.findByRole('heading', { name: 'Historial de versiones' });
    await usuario.click(restaurar(1));

    const panel = screen.getByRole('form', { name: '¿Restaurar la versión 1?' });
    expect(panel).toHaveTextContent('Se creará una versión nueva (la 4) con el mismo contenido que la versión 1');
    expect(panel).toHaveTextContent('No se borra nada');
    expect(panel).toHaveTextContent('incluida la 3');
    expect(screen.getByRole('heading', { name: '¿Restaurar la versión 1?' })).toHaveFocus();
    expect(api.a('POST', '/documentos/12/versiones/1/restaurar')).toHaveLength(0);
  });

  it('cancelar cierra la confirmación, devuelve el foco al botón y no envía nada', async () => {
    const usuario = userEvent.setup();
    const api = montar('editor');
    await screen.findByRole('heading', { name: 'Historial de versiones' });
    await usuario.click(restaurar(1));
    await usuario.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('form', { name: /Restaurar/ })).not.toBeInTheDocument();
    await waitFor(() => expect(restaurar(1)).toHaveFocus());
    expect(api.a('POST', '/documentos/12/versiones/1/restaurar')).toHaveLength(0);
  });

  it('confirmar sin motivo envía un cuerpo vacío, recarga el historial con la versión nueva y avisa', async () => {
    const usuario = userEvent.setup();
    const api = montar('editor');
    await screen.findByRole('heading', { name: 'Historial de versiones' });
    await usuario.click(restaurar(1));
    await usuario.click(confirmar());

    const aviso = await screen.findByText(
      'Se creó la versión 4 con el contenido de la versión 1. Las versiones anteriores siguen en el historial.',
    );
    expect(api.a('POST', '/documentos/12/versiones/1/restaurar')[0].cuerpo).toEqual({});
    expect(await screen.findByRole('heading', { level: 3, name: /^Versión 4/ })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(4);
    expect(api.a('GET', '/documentos/12')).toHaveLength(2);
    expect(screen.queryByRole('form', { name: /Restaurar/ })).not.toBeInTheDocument();
    await waitFor(() => expect(aviso).toHaveFocus());
  });

  it('con motivo, lo envía sin espacios sobrantes', async () => {
    const usuario = userEvent.setup();
    const api = montar('administrador');
    await screen.findByRole('heading', { name: 'Historial de versiones' });
    await usuario.click(restaurar(1));
    await usuario.type(screen.getByLabelText(/^Motivo de la restauración/), '  Volvemos a la original  ');
    expect(screen.getByText('26 / 300 caracteres')).toBeInTheDocument();
    await usuario.click(confirmar());
    await screen.findByText(/Se creó la versión 4/);
    expect(api.a('POST', '/documentos/12/versiones/1/restaurar')[0].cuerpo).toEqual({ motivo: 'Volvemos a la original' });
  });

  it('409: la vigente ya tiene ese contenido: lo explica y deja la confirmación abierta', async () => {
    const usuario = userEvent.setup();
    montar('editor', () =>
      respuestaJson(
        { statusCode: 409, error: 'Conflict', message: 'La versión vigente (3) ya tiene el mismo contenido que la 1', versionVigente: 3 },
        409,
      ),
    );
    await screen.findByRole('heading', { name: 'Historial de versiones' });
    await usuario.click(restaurar(1));
    await usuario.click(confirmar());
    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('La versión vigente (3) ya tiene el mismo contenido que la versión que quieres restaurar');
    expect(alerta).toHaveTextContent('no se creó ninguna versión nueva');
    expect(alerta).toHaveFocus();
    expect(screen.getByRole('form', { name: '¿Restaurar la versión 1?' })).toBeInTheDocument();
    expect(confirmar()).toBeEnabled();
  });

  it.each([
    ['403', 403, { message: 'Forbidden resource' }, /administradores y los editores/, 'Forbidden resource'],
    ['404', 404, { message: 'No existe la versión 1 del documento 12' }, /versión o el documento ya no existe/, 'No existe la versión 1'],
    ['500', 500, { message: 'error interno' }, /El servidor tuvo un problema/, 'error interno'],
  ])('%s: mensaje claro', async (_nombre, estado, cuerpo, esperado, crudo) => {
    const usuario = userEvent.setup();
    montar('editor', () => respuestaJson(cuerpo, estado));
    await screen.findByRole('heading', { name: 'Historial de versiones' });
    await usuario.click(restaurar(1));
    await usuario.click(confirmar());
    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent(esperado);
    expect(alerta).not.toHaveTextContent(crudo);
  });

  it('sin red, recuerda mirar el historial antes de repetir', async () => {
    const usuario = userEvent.setup();
    montar('editor', () => Promise.reject(new TypeError('Failed to fetch')) as unknown as Response);
    await screen.findByRole('heading', { name: 'Historial de versiones' });
    await usuario.click(restaurar(1));
    await usuario.click(confirmar());
    expect(await screen.findByRole('alert')).toHaveTextContent('mira el historial');
  });

  it('mientras restaura, deshabilita los botones y no envía dos veces', async () => {
    const usuario = userEvent.setup();
    let terminar: (r: Response) => void = () => undefined;
    const api = montar('editor', () => new Promise<Response>((resolver) => (terminar = resolver)));
    await screen.findByRole('heading', { name: 'Historial de versiones' });
    await usuario.click(restaurar(1));
    await usuario.click(confirmar());
    const enCurso = await screen.findByRole('button', { name: 'Restaurando…' });
    expect(enCurso).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    await usuario.click(enCurso);
    expect(api.a('POST', '/documentos/12/versiones/1/restaurar')).toHaveLength(1);
    terminar(respuestaJson(versionDePrueba(4, { restauradaDe: 1 }), 201));
    await screen.findByText(/Se creó la versión 4/);
  });

  it('abrir la confirmación de otra versión cambia el panel: solo hay uno abierto', async () => {
    const usuario = userEvent.setup();
    montar('editor');
    await screen.findByRole('heading', { name: 'Historial de versiones' });
    await usuario.click(restaurar(1));
    await usuario.click(restaurar(2));
    expect(screen.getAllByRole('form')).toHaveLength(1);
    expect(screen.getByRole('form', { name: '¿Restaurar la versión 2?' })).toBeInTheDocument();
  });
});
