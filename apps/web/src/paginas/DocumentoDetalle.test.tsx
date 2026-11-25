import { screen, within } from '@testing-library/react';
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
} from '../pruebas/ayudas';

function version(numero: number, cambios: Partial<VersionDetalle> = {}): VersionDetalle {
  return {
    numero,
    nombreOriginal: `acta-v${numero}.pdf`,
    sha256: `${numero}`.padStart(64, 'a'),
    tamano: 12595 * numero,
    motivo: numero === 1 ? 'Carga inicial' : `Cambio ${numero}`,
    restauradaDe: null,
    textoEstado: 'ok',
    autorId: 1,
    autor: 'editor.demo',
    creadoEn: `2026-11-2${numero}T15:30:00.000Z`,
    ...cambios,
  };
}

function documentoConVersiones(versiones: VersionDetalle[]): DocumentoConVersiones {
  const { versionActual: _quitada, ...documento } = documentoDePrueba(12, { titulo: 'Acta de comité 12' });
  return { ...documento, versiones };
}

function montar(rol: 'consulta' | 'editor' | 'administrador', respuesta: () => Response, ruta = '/documentos/12') {
  const api = simularApi({
    ...manejadoresDeSesion(rol),
    'GET /series': () => respuestaJson(CUADRO),
    'GET /documentos/12': respuesta,
  });
  renderizarApp(ruta);
  return api;
}

describe('detalle de un documento', () => {
  const tres = [version(3, { restauradaDe: 1, motivo: 'Restaura la versión 1' }), version(2), version(1, { textoEstado: 'sin_texto' })];

  it('muestra los datos del documento, con el nombre de la serie', async () => {
    montar('consulta', () => respuestaJson(documentoConVersiones(tres)));
    expect(await screen.findByRole('heading', { level: 1, name: 'Acta de comité 12' })).toBeInTheDocument();
    expect(screen.getByText('EXP-2026-012')).toBeInTheDocument();
    expect(await screen.findByText('100-01 · Contratos de obra (serie 100 · Gestión contractual)')).toBeInTheDocument();
    expect(screen.getByText(/15 de marzo de 2026/)).toBeInTheDocument();
    expect(document.title).toBe('Acta de comité 12 · Faro');
  });

  it('el historial lista todas las versiones, la más reciente primero, con autor, fecha y motivo', async () => {
    montar('consulta', () => respuestaJson(documentoConVersiones(tres)));
    await screen.findByRole('heading', { name: 'Historial de versiones' });
    const titulos = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(titulos[0]).toMatch(/^Versión 3/);
    expect(titulos[1]).toMatch(/^Versión 2/);
    expect(titulos[2]).toMatch(/^Versión 1/);

    const [v3, , v1] = screen.getAllByRole('listitem').filter((li) => li.classList.contains('tarjeta'));
    expect(within(v3).getByText('Vigente')).toBeInTheDocument();
    expect(within(v3).getByText('Restaura la versión 1', { selector: '.etiqueta' })).toBeInTheDocument();
    expect(within(v3).getByText('editor.demo')).toBeInTheDocument();
    expect(within(v3).getByText('acta-v3.pdf')).toBeInTheDocument();
    expect(within(v3).getByText('36,9 KB')).toBeInTheDocument();
    expect(within(v1).queryByText('Vigente')).not.toBeInTheDocument();
    expect(within(v1).getByText('Carga inicial')).toBeInTheDocument();
    expect(within(v1).getByText(/Sin capa de texto/)).toBeInTheDocument();
    expect(within(v3).queryByText(/Sin capa de texto/)).not.toBeInTheDocument();
  });

  it('cada versión y la vigente se descargan por la ruta de la API', async () => {
    montar('consulta', () => respuestaJson(documentoConVersiones(tres)));
    const vigente = await screen.findByRole('link', { name: 'Descargar la versión vigente (PDF)' });
    expect(vigente).toHaveAttribute('href', '/documentos/12/versiones/3/archivo');
    expect(vigente).toHaveAttribute('download');
    expect(screen.getByRole('link', { name: 'Descargar la versión 2' })).toHaveAttribute('href', '/documentos/12/versiones/2/archivo');
    expect(screen.getByRole('link', { name: 'Descargar la versión 1' })).toHaveAttribute('href', '/documentos/12/versiones/1/archivo');
  });

  it('editor y administrador ven «Subir una versión nueva»; consulta no', async () => {
    montar('editor', () => respuestaJson(documentoConVersiones(tres)));
    const enlace = await screen.findByRole('link', { name: 'Subir una versión nueva' });
    expect(enlace).toHaveAttribute('href', '/documentos/12/version');
  });

  it('el rol de consulta no ve subir versión, pero sí descargar', async () => {
    montar('consulta', () => respuestaJson(documentoConVersiones(tres)));
    await screen.findByRole('heading', { name: 'Historial de versiones' });
    expect(screen.queryByRole('link', { name: 'Subir una versión nueva' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Descargar la versión vigente (PDF)' })).toBeInTheDocument();
  });

  it('«Subir una versión nueva» lleva a la pantalla marcador del #24', async () => {
    const usuario = userEvent.setup();
    montar('administrador', () => respuestaJson(documentoConVersiones(tres)));
    await usuario.click(await screen.findByRole('link', { name: 'Subir una versión nueva' }));
    expect(await screen.findByRole('heading', { name: 'Subir una versión nueva' })).toBeInTheDocument();
    expect(screen.getByText(/issue #24/)).toBeInTheDocument();
  });

  it('un documento que no existe (404): lo dice y ofrece volver', async () => {
    montar('consulta', () => respuestaJson({ statusCode: 404, message: 'No existe el documento 12', error: 'Not Found' }, 404));
    expect(await screen.findByRole('heading', { name: 'El documento no existe' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Volver a los documentos' })).toHaveAttribute('href', '/documentos');
  });

  it('un identificador que no es un número: no existe, y ni siquiera pregunta a la API', async () => {
    const api = montar('consulta', () => respuestaJson({}, 500), '/documentos/abc');
    expect(await screen.findByRole('heading', { name: 'El documento no existe' })).toBeInTheDocument();
    expect(api.a('GET', '/documentos/abc')).toHaveLength(0);
  });

  it('un fallo del servidor: mensaje propio y «Reintentar»', async () => {
    const usuario = userEvent.setup();
    let falla = true;
    const api = montar('consulta', () => (falla ? respuestaJson({ message: 'interno' }, 500) : respuestaJson(documentoConVersiones(tres))));
    expect(await screen.findByRole('alert')).toHaveTextContent(/El servidor tuvo un problema/);
    falla = false;
    await usuario.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Acta de comité 12' })).toBeInTheDocument();
    expect(api.a('GET', '/documentos/12')).toHaveLength(2);
  });

  it('desde el listado se llega al detalle y se puede volver', async () => {
    const usuario = userEvent.setup();
    simularApi({
      ...manejadoresDeSesion('consulta'),
      'GET /series': () => respuestaJson(CUADRO),
      'GET /documentos': () => respuestaJson({ items: [documentoDePrueba(12, { titulo: 'Acta de comité 12' })], total: 1, pagina: 1, tamano: 10 }),
      'GET /documentos/12': () => respuestaJson(documentoConVersiones(tres)),
    });
    renderizarApp('/documentos');
    await usuario.click(await screen.findByRole('link', { name: 'Acta de comité 12' }));
    expect(await screen.findByRole('heading', { name: 'Historial de versiones' })).toBeInTheDocument();
    expect(screen.getByTestId('ubicacion')).toHaveTextContent('/documentos/12');
    await usuario.click(screen.getByRole('link', { name: '← Documentos' }));
    expect(await screen.findByRole('heading', { name: 'Documentos' })).toBeInTheDocument();
  });
});
