import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { DocumentoConVersiones } from '../api/documentos';
import { archivoPdf, CUADRO, documentoDePrueba, manejadoresDeSesion, renderizarApp, respuestaJson, simularApi } from '../pruebas/ayudas';
import { versionDePrueba } from '../pruebas/carga';

type Manejadores = Parameters<typeof simularApi>[0];

function documentoCon(versiones: number): DocumentoConVersiones {
  const { versionActual: _quitada, ...basico } = documentoDePrueba(12, { titulo: 'Acta de comité 12' });
  return { ...basico, versiones: Array.from({ length: versiones }, (_, i) => versionDePrueba(versiones - i)) };
}

function montar(extra: Manejadores = {}, rol: 'editor' | 'administrador' | 'consulta' = 'editor', ruta = '/documentos/12/version') {
  const api = simularApi({
    ...manejadoresDeSesion(rol),
    'GET /series': () => respuestaJson(CUADRO),
    'GET /documentos/12': () => respuestaJson(documentoCon(2)),
    ...extra,
  });
  renderizarApp(ruta);
  return api;
}

const boton = (nombre: string | RegExp) => screen.getByRole('button', { name: nombre });

async function llenar(usuario: ReturnType<typeof userEvent.setup>, archivo = archivoPdf('acta-v3.pdf'), motivo = 'Se corrigió la cláusula 4') {
  await usuario.upload(screen.getByLabelText(/Archivo PDF/), archivo);
  await usuario.type(screen.getByLabelText(/^Motivo del cambio/), motivo);
}

describe('formulario de versión nueva', () => {
  it('muestra el documento, su versión vigente y los dos campos con su ayuda', async () => {
    montar();
    expect(await screen.findByRole('heading', { level: 1, name: 'Subir una versión nueva' })).toBeInTheDocument();
    expect(screen.getByText('Acta de comité 12', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText(/La versión vigente es la 2/)).toBeInTheDocument();
    expect(screen.getByText(/No se borra nada/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Archivo PDF \(obligatorio\)/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Motivo del cambio \(obligatorio\)/)).toHaveAccessibleDescription(/Explica qué cambió en esta versión/);
    expect(screen.getByRole('link', { name: '← Acta de comité 12' })).toHaveAttribute('href', '/documentos/12');
  });

  it('enviar vacío: errores en el archivo y el motivo, foco al primero, nada se envía', async () => {
    const usuario = userEvent.setup();
    const api = montar();
    await screen.findByRole('heading', { level: 1, name: 'Subir una versión nueva' });
    await usuario.click(boton('Subir versión nueva'));
    expect(screen.getByText('Elige el archivo PDF que quieres subir.')).toBeInTheDocument();
    expect(screen.getByText('Escribe el motivo: explica qué cambió en esta versión.')).toBeInTheDocument();
    expect(screen.getByLabelText(/Archivo PDF/)).toHaveFocus();
    expect(api.a('POST', '/documentos/12/versiones')).toHaveLength(0);
  });

  it('el motivo es obligatorio: solo espacios no cuenta', async () => {
    const usuario = userEvent.setup();
    const api = montar();
    await screen.findByRole('heading', { level: 1, name: 'Subir una versión nueva' });
    await llenar(usuario, archivoPdf(), '     ');
    await usuario.click(boton('Subir versión nueva'));
    expect(screen.getByLabelText(/^Motivo del cambio/)).toHaveFocus();
    expect(api.a('POST', '/documentos/12/versiones')).toHaveLength(0);
  });

  it('el motivo cuenta caracteres y el límite es de 300', async () => {
    const usuario = userEvent.setup();
    const api = montar();
    await screen.findByRole('heading', { level: 1, name: 'Subir una versión nueva' });
    const motivo = screen.getByLabelText(/^Motivo del cambio/);
    expect(motivo).toHaveAttribute('maxlength', '300');
    await usuario.type(motivo, 'Hola');
    expect(screen.getByText('4 / 300 caracteres')).toBeInTheDocument();
    // Un texto pegado por encima del límite (sin respetar maxlength) también se rechaza.
    fireEvent.change(motivo, { target: { value: 'x'.repeat(301) } });
    await usuario.upload(screen.getByLabelText(/Archivo PDF/), archivoPdf());
    await usuario.click(boton('Subir versión nueva'));
    expect(screen.getByText('Máximo 300 caracteres: este tiene 301.')).toBeInTheDocument();
    expect(api.a('POST', '/documentos/12/versiones')).toHaveLength(0);
  });

  it('un archivo que no es PDF o de más de 20 MB se rechaza en el navegador', async () => {
    const usuario = userEvent.setup({ applyAccept: false });
    const api = montar();
    await screen.findByRole('heading', { level: 1, name: 'Subir una versión nueva' });
    await llenar(usuario, new File(['x'], 'notas.txt', { type: 'text/plain' }));
    await usuario.click(boton('Subir versión nueva'));
    expect(screen.getByText(/El archivo no es un PDF/)).toBeInTheDocument();
    await usuario.upload(screen.getByLabelText(/Archivo PDF/), archivoPdf('enorme.pdf', 21 * 1024 * 1024));
    await usuario.click(boton('Subir versión nueva'));
    expect(screen.getByText(/Pasa de 20 MB/)).toBeInTheDocument();
    expect(api.a('POST', '/documentos/12/versiones')).toHaveLength(0);
  });

  it('envía archivo y motivo, y vuelve al detalle con la versión nueva y un aviso', async () => {
    const usuario = userEvent.setup();
    let subida = false;
    const api = montar({
      'GET /documentos/12': () => respuestaJson(documentoCon(subida ? 3 : 2)),
      'POST /documentos/12/versiones': () => {
        subida = true;
        return respuestaJson(versionDePrueba(3), 201);
      },
    });
    await screen.findByRole('heading', { level: 1, name: 'Subir una versión nueva' });
    await llenar(usuario, archivoPdf('acta-v3.pdf'), '  Se corrigió la cláusula 4  ');
    await usuario.click(boton('Subir versión nueva'));

    expect(await screen.findByRole('heading', { level: 1, name: 'Acta de comité 12' })).toBeInTheDocument();
    const [llamada] = api.a('POST', '/documentos/12/versiones');
    expect(llamada.formulario?.get('motivo')).toBe('Se corrigió la cláusula 4');
    const archivoEnviado = llamada.formulario?.get('archivo');
    expect(archivoEnviado instanceof File && archivoEnviado.name).toBe('acta-v3.pdf');
    const claves = llamada.formulario ? [...llamada.formulario.keys()] : [];
    expect(claves.sort((a, b) => a.localeCompare(b))).toEqual(['archivo', 'motivo']);
    expect(screen.getByTestId('ubicacion')).toHaveTextContent('/documentos/12');
    expect(screen.getByText(/Se agregó la versión 3 de «Acta de comité 12»/)).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 3, name: /^Versión 3/ })).toBeInTheDocument();
  });

  it('mientras sube, deshabilita todo y un segundo envío no sale', async () => {
    const usuario = userEvent.setup();
    let terminar: (r: Response) => void = () => undefined;
    const api = montar({ 'POST /documentos/12/versiones': () => new Promise<Response>((resolver) => (terminar = resolver)) });
    await screen.findByRole('heading', { level: 1, name: 'Subir una versión nueva' });
    await llenar(usuario);
    await usuario.click(boton('Subir versión nueva'));
    const enCurso = await screen.findByRole('button', { name: 'Subiendo la versión…' });
    expect(enCurso).toBeDisabled();
    expect(screen.getByLabelText(/^Motivo del cambio/)).toBeDisabled();
    fireEvent.submit(enCurso.closest('form') as HTMLFormElement);
    expect(api.a('POST', '/documentos/12/versiones')).toHaveLength(1);
    terminar(respuestaJson(versionDePrueba(3), 201));
    expect(await screen.findByRole('heading', { level: 1, name: 'Acta de comité 12' })).toBeInTheDocument();
  });

  describe('errores', () => {
    it('409: el contenido ya está en una versión del documento: lo dice, con el número, y conserva lo escrito', async () => {
      const usuario = userEvent.setup();
      montar({
        'POST /documentos/12/versiones': () =>
          respuestaJson({ statusCode: 409, error: 'Conflict', message: 'Este contenido ya está en la versión 1 del documento', versionExistente: 1 }, 409),
      });
      await screen.findByRole('heading', { level: 1, name: 'Subir una versión nueva' });
      await llenar(usuario);
      await usuario.click(boton('Subir versión nueva'));
      const alerta = await screen.findByRole('alert');
      expect(alerta).toHaveTextContent('mismo contenido que la versión 1 del documento');
      expect(alerta).toHaveTextContent('no se creó ninguna versión nueva');
      expect(alerta).toHaveFocus();
      expect(screen.getByLabelText(/^Motivo del cambio/)).toHaveValue('Se corrigió la cláusula 4');
      expect(boton('Subir versión nueva')).toBeEnabled();
    });

    it.each([
      ['413', 413, { message: 'File too large' }, /pesa más de 20 MB/, 'File too large'],
      ['415', 415, { message: 'El archivo no es un PDF' }, /no es un PDF válido/, undefined],
      ['403', 403, { message: 'Forbidden resource' }, /administradores y los editores/, 'Forbidden resource'],
      ['404', 404, { message: 'No existe el documento 12' }, /El documento ya no existe/, undefined],
      ['429', 429, { message: 'Too Many Requests' }, /demasiadas peticiones/, 'Too Many Requests'],
      ['500', 500, { message: 'stack trace interno' }, /El servidor tuvo un problema/, 'stack trace'],
    ])('%s: mensaje claro en español', async (_nombre, estado, cuerpo, esperado, crudo) => {
      const usuario = userEvent.setup();
      montar({ 'POST /documentos/12/versiones': () => respuestaJson(cuerpo, estado) });
      await screen.findByRole('heading', { level: 1, name: 'Subir una versión nueva' });
      await llenar(usuario);
      await usuario.click(boton('Subir versión nueva'));
      const alerta = await screen.findByRole('alert');
      expect(alerta).toHaveTextContent(esperado);
      if (crudo) expect(alerta).not.toHaveTextContent(crudo);
    });

    it('un 400 de validación señala el motivo y le da el foco', async () => {
      const usuario = userEvent.setup();
      montar({
        'POST /documentos/12/versiones': () =>
          respuestaJson({ message: 'Datos inválidos', problemas: ['motivo: no puede pasar de 300 caracteres'] }, 400),
      });
      await screen.findByRole('heading', { level: 1, name: 'Subir una versión nueva' });
      await llenar(usuario);
      await usuario.click(boton('Subir versión nueva'));
      await screen.findByText('El motivo no puede pasar de 300 caracteres.', { selector: '.campo__error' });
      expect(screen.getByLabelText(/^Motivo del cambio/)).toHaveFocus();
    });

    it('sin red: lo dice', async () => {
      const usuario = userEvent.setup();
      montar({ 'POST /documentos/12/versiones': () => Promise.reject(new TypeError('Failed to fetch')) as unknown as Response });
      await screen.findByRole('heading', { level: 1, name: 'Subir una versión nueva' });
      await llenar(usuario);
      await usuario.click(boton('Subir versión nueva'));
      expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo conectar con el servidor');
    });
  });

  describe('el documento', () => {
    it('que no existe (404): lo dice y no ofrece subir nada', async () => {
      montar({ 'GET /documentos/12': () => respuestaJson({ statusCode: 404, message: 'No existe el documento 12' }, 404) });
      expect(await screen.findByRole('heading', { name: 'El documento no existe' })).toBeInTheDocument();
      expect(screen.queryByLabelText(/Archivo PDF/)).not.toBeInTheDocument();
    });

    it('con un identificador que no es un número: no existe, y ni siquiera pregunta a la API', async () => {
      const api = montar({}, 'editor', '/documentos/abc/version');
      expect(await screen.findByRole('heading', { name: 'El documento no existe' })).toBeInTheDocument();
      expect(api.a('GET', '/documentos/abc')).toHaveLength(0);
    });

    it('si no carga, lo dice y deja reintentar', async () => {
      const usuario = userEvent.setup();
      let falla = true;
      montar({ 'GET /documentos/12': () => (falla ? respuestaJson({ message: 'x' }, 500) : respuestaJson(documentoCon(2))) });
      expect(await screen.findByRole('alert')).toHaveTextContent('El servidor tuvo un problema');
      falla = false;
      await usuario.click(boton('Reintentar'));
      expect(await screen.findByRole('heading', { level: 1, name: 'Subir una versión nueva' })).toBeInTheDocument();
    });
  });

  describe('permisos', () => {
    it('el rol de consulta no entra por la dirección: sin permiso, y no se pide el documento', async () => {
      const api = montar({}, 'consulta');
      expect(await screen.findByRole('heading', { name: /No tienes permiso/ })).toBeInTheDocument();
      expect(screen.queryByLabelText(/Archivo PDF/)).not.toBeInTheDocument();
      expect(api.a('GET', '/documentos/12')).toHaveLength(0);
      expect(api.a('POST', '/documentos/12/versiones')).toHaveLength(0);
    });

    it.each(['editor', 'administrador'] as const)('%s sí llega al formulario', async (rol) => {
      montar({}, rol);
      expect(await screen.findByRole('heading', { level: 1, name: 'Subir una versión nueva' })).toBeInTheDocument();
    });
  });
});
