import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { crearDireccionFalsa, liberarDireccionFalsa } from '../pruebas/blobs';
import {
  archivoPdf,
  CUADRO,
  manejadoresDeSesion,
  renderizarApp,
  respuestaJson,
  simularApi,
  type Llamada,
} from '../pruebas/ayudas';
import {
  CANDIDATO,
  cuerpoDeExacto,
  cuerpoDeProbable,
  documentoExistente,
  llenarFormularioDeCarga,
  respuestaDeCreado,
} from '../pruebas/carga';

type Manejadores = Parameters<typeof simularApi>[0];

function montar(extra: Manejadores = {}, rol: 'editor' | 'administrador' | 'consulta' = 'editor') {
  const api = simularApi({
    ...manejadoresDeSesion(rol),
    'GET /series': () => respuestaJson(CUADRO),
    'POST /documentos': () => respuestaDeCreado(),
    'GET /documentos/31': () => respuestaJson({ ...documentoExistente(), id: 31, titulo: 'Acta de comité 12', versiones: [documentoExistente().versiones[1]] }),
    ...extra,
  });
  renderizarApp('/documentos/nuevo');
  return api;
}

const ubicacion = () => screen.getByTestId('ubicacion');
const boton = (nombre: string | RegExp) => screen.getByRole('button', { name: nombre });

/** Los campos de texto del formulario multipart de una llamada, más el nombre del archivo. */
function enviado(llamada: Llamada): Record<string, string> {
  const resultado: Record<string, string> = {};
  for (const [clave, valor] of llamada.formulario?.entries() ?? []) {
    resultado[clave] = typeof valor === 'string' ? valor : `archivo:${valor.name}`;
  }
  return resultado;
}

describe('formulario de carga', () => {
  it('muestra cada campo con su etiqueta y ayuda, y solo las subseries, agrupadas por serie', async () => {
    montar();
    expect(await screen.findByRole('heading', { level: 1, name: 'Cargar un documento' })).toBeInTheDocument();
    for (const etiqueta of [/^Archivo PDF \(obligatorio\)/, /^Título \(obligatorio\)/, /^Expediente \(obligatorio\)/, /^Subserie \(obligatorio\)/, /^Fecha del documento \(obligatorio\)/, /^Motivo de la carga \(opcional\)/]) {
      expect(screen.getByLabelText(etiqueta)).toBeInTheDocument();
    }
    expect(screen.getByLabelText(/Archivo PDF/)).toHaveAccessibleDescription(/Solo PDF, hasta 20 MB/);
    expect(screen.getByLabelText(/^Motivo de la carga/)).toHaveAccessibleDescription(/Carga inicial/);
    const selector = screen.getByLabelText(/^Subserie/);
    await waitFor(() => expect(within(selector).getAllByRole('option')).toHaveLength(4));
    expect(within(selector).getByRole('option', { name: '100-01 · Contratos de obra' })).toBeInTheDocument();
    expect(within(selector).queryByRole('option', { name: /Gestión contractual/ })).not.toBeInTheDocument();
    expect(within(selector).getByRole('group', { name: '100 · Gestión contractual' })).toBeInTheDocument();
  });

  it('enviar vacío: un error por campo, el foco al primero, y nada se envía', async () => {
    const usuario = userEvent.setup();
    const api = montar();
    await screen.findByRole('heading', { level: 1, name: 'Cargar un documento' });
    await usuario.click(boton('Cargar documento'));

    expect(screen.getByText('Elige el archivo PDF que quieres subir.')).toBeInTheDocument();
    expect(screen.getByText('Escribe el título del documento.')).toBeInTheDocument();
    expect(screen.getByText('Escribe el número o código del expediente.')).toBeInTheDocument();
    expect(screen.getByText('Elige la subserie donde se clasifica el documento.')).toBeInTheDocument();
    expect(screen.getByText('Indica la fecha que figura en el documento.')).toBeInTheDocument();
    expect(screen.getByLabelText(/Archivo PDF/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/Archivo PDF/)).toHaveFocus();
    expect(screen.getByLabelText(/^Título/)).toHaveAccessibleDescription(/Escribe el título del documento/);
    expect(api.a('POST', '/documentos')).toHaveLength(0);
  });

  it('el foco pasa al siguiente campo con error cuando el anterior ya está bien', async () => {
    const usuario = userEvent.setup();
    montar();
    await screen.findByRole('heading', { level: 1, name: 'Cargar un documento' });
    await usuario.upload(screen.getByLabelText(/Archivo PDF/), archivoPdf());
    await usuario.click(boton('Cargar documento'));
    expect(screen.queryByText('Elige el archivo PDF que quieres subir.')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Título/)).toHaveFocus();
  });

  it('un archivo que no es PDF se rechaza en el navegador, sin enviar nada', async () => {
    const usuario = userEvent.setup({ applyAccept: false });
    const api = montar();
    await screen.findByRole('heading', { level: 1, name: 'Cargar un documento' });
    await llenarFormularioDeCarga(usuario, { archivo: new File(['x'], 'foto.png', { type: 'image/png' }) });
    await usuario.click(boton('Cargar documento'));
    expect(screen.getByText(/El archivo no es un PDF/)).toBeInTheDocument();
    expect(api.a('POST', '/documentos')).toHaveLength(0);
  });

  it('un archivo de más de 20 MB se rechaza en el navegador, diciendo cuánto pesa', async () => {
    const usuario = userEvent.setup();
    const api = montar();
    await screen.findByRole('heading', { level: 1, name: 'Cargar un documento' });
    await llenarFormularioDeCarga(usuario, { archivo: archivoPdf('enorme.pdf', 25 * 1024 * 1024) });
    await usuario.click(boton('Cargar documento'));
    expect(screen.getByText(/Pasa de 20 MB: este archivo pesa 25,0 MB/)).toBeInTheDocument();
    expect(api.a('POST', '/documentos')).toHaveLength(0);
  });

  it('al elegir un archivo se muestra su nombre y tamaño', async () => {
    const usuario = userEvent.setup();
    montar();
    await screen.findByRole('heading', { level: 1, name: 'Cargar un documento' });
    await usuario.upload(screen.getByLabelText(/Archivo PDF/), archivoPdf('plano.pdf', 2048));
    expect(screen.getByText('plano.pdf')).toBeInTheDocument();
    expect(screen.getByText(/2,0 KB/)).toBeInTheDocument();
  });

  it('un texto de solo espacios no cuenta como título', async () => {
    const usuario = userEvent.setup();
    const api = montar();
    await screen.findByRole('heading', { level: 1, name: 'Cargar un documento' });
    await llenarFormularioDeCarga(usuario, { titulo: '    ' });
    await usuario.click(boton('Cargar documento'));
    expect(screen.getByText('Escribe el título del documento.')).toBeInTheDocument();
    expect(api.a('POST', '/documentos')).toHaveLength(0);
  });

  it('los campos de texto cuentan sus caracteres y limitan el largo a lo que admite la API', async () => {
    const usuario = userEvent.setup();
    montar();
    await screen.findByRole('heading', { level: 1, name: 'Cargar un documento' });
    await usuario.type(screen.getByLabelText(/^Título/), 'Acta');
    expect(screen.getByText('4 / 200 caracteres')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Título/)).toHaveAttribute('maxlength', '200');
    expect(screen.getByLabelText(/^Expediente/)).toHaveAttribute('maxlength', '60');
    expect(screen.getByLabelText(/^Motivo de la carga/)).toHaveAttribute('maxlength', '300');
  });

  it('una carga válida envía el formulario multipart con los datos y lleva al detalle con un aviso', async () => {
    const usuario = userEvent.setup();
    const api = montar();
    await screen.findByRole('heading', { level: 1, name: 'Cargar un documento' });
    await llenarFormularioDeCarga(usuario, {
      archivo: archivoPdf('acta-12.pdf'),
      titulo: 'Acta de comité 12',
      expediente: 'EXP-2026-012',
      serie: '21',
      fecha: '2026-03-15',
      motivo: 'Lote de marzo',
    });
    await usuario.click(boton('Cargar documento'));

    expect(await screen.findByRole('heading', { level: 1, name: 'Acta de comité 12' })).toBeInTheDocument();
    const llamadas = api.a('POST', '/documentos');
    expect(llamadas).toHaveLength(1);
    expect(enviado(llamadas[0])).toEqual({
      titulo: 'Acta de comité 12',
      expediente: 'EXP-2026-012',
      serieId: '21',
      fechaDocumento: '2026-03-15',
      motivo: 'Lote de marzo',
      archivo: 'archivo:acta-12.pdf',
    });
    expect(ubicacion()).toHaveTextContent('/documentos/31');
    expect(screen.getByText(/Documento «Acta de comité 12» cargado: quedó como la versión 1/)).toBeInTheDocument();
  });

  it('sin motivo, no envía el campo (la API pone «Carga inicial»)', async () => {
    const usuario = userEvent.setup();
    const api = montar();
    await screen.findByRole('heading', { level: 1, name: 'Cargar un documento' });
    await llenarFormularioDeCarga(usuario);
    await usuario.click(boton('Cargar documento'));
    await screen.findByRole('heading', { level: 1, name: 'Acta de comité 12' });
    expect(enviado(api.a('POST', '/documentos')[0])).not.toHaveProperty('motivo');
    expect(enviado(api.a('POST', '/documentos')[0])).not.toHaveProperty('decision');
  });

  describe('mientras sube', () => {
    it('deshabilita el formulario, lo dice, y un segundo clic no envía otra vez', async () => {
      const usuario = userEvent.setup();
      let terminar: (r: Response) => void = () => undefined;
      const api = montar({ 'POST /documentos': () => new Promise<Response>((resolver) => (terminar = resolver)) });
      await screen.findByRole('heading', { level: 1, name: 'Cargar un documento' });
      await llenarFormularioDeCarga(usuario);
      await usuario.click(boton('Cargar documento'));

      const enCurso = await screen.findByRole('button', { name: 'Subiendo el documento…' });
      expect(enCurso).toBeDisabled();
      expect(screen.getByLabelText(/^Título/)).toBeDisabled();
      expect(screen.getByLabelText(/Archivo PDF/)).toBeDisabled();
      await usuario.click(enCurso);
      fireEvent.submit(enCurso.closest('form') as HTMLFormElement);
      expect(api.a('POST', '/documentos')).toHaveLength(1);

      terminar(respuestaDeCreado());
      expect(await screen.findByRole('heading', { level: 1, name: 'Acta de comité 12' })).toBeInTheDocument();
      expect(api.a('POST', '/documentos')).toHaveLength(1);
    });

    it('si falla, el formulario vuelve a quedar disponible con lo escrito', async () => {
      const usuario = userEvent.setup();
      let intento = 0;
      const api = montar({
        'POST /documentos': () => (++intento === 1 ? respuestaJson({ message: 'interno' }, 500) : respuestaDeCreado()),
      });
      await screen.findByRole('heading', { level: 1, name: 'Cargar un documento' });
      await llenarFormularioDeCarga(usuario, { titulo: 'Plano de la vía' });
      await usuario.click(boton('Cargar documento'));
      expect(await screen.findByRole('alert')).toHaveTextContent('El servidor tuvo un problema');
      expect(boton('Cargar documento')).toBeEnabled();
      expect(screen.getByLabelText(/^Título/)).toHaveValue('Plano de la vía');
      await usuario.click(boton('Cargar documento'));
      await screen.findByRole('heading', { level: 1, name: 'Acta de comité 12' });
      expect(api.a('POST', '/documentos')).toHaveLength(2);
    });
  });

  describe('errores de la API, en español y sin texto técnico', () => {
    const casos: Array<[string, number, unknown, RegExp, string | undefined]> = [
      ['413: archivo grande', 413, { statusCode: 413, message: 'File too large', error: 'Payload Too Large' }, /pesa más de 20 MB/, 'File too large'],
      ['415: no es un PDF', 415, { statusCode: 415, message: 'El archivo no es un PDF' }, /no es un PDF válido/, undefined],
      ['403: sin permiso', 403, { statusCode: 403, message: 'Forbidden resource' }, /administradores y los editores/, 'Forbidden resource'],
      ['422: la serie no admite documentos', 422, { statusCode: 422, message: 'La serie 1 no admite documentos' }, /no admite documentos/, undefined],
      ['404: la subserie ya no existe', 404, { statusCode: 404, message: 'No existe la serie 99' }, /subserie o el documento elegido/, 'No existe la serie 99'],
      ['429: demasiadas peticiones', 429, { statusCode: 429, message: 'ThrottlerException: Too Many Requests' }, /demasiadas peticiones/, 'Too Many Requests'],
      ['500: fallo del servidor', 500, { statusCode: 500, message: 'Internal server error: relation does not exist' }, /El servidor tuvo un problema/, 'relation does not exist'],
    ];

    it.each(casos)('%s', async (_nombre, estado, cuerpo, esperado, crudo) => {
      const usuario = userEvent.setup();
      montar({ 'POST /documentos': () => respuestaJson(cuerpo, estado) });
      await screen.findByRole('heading', { level: 1, name: 'Cargar un documento' });
      await llenarFormularioDeCarga(usuario);
      await usuario.click(boton('Cargar documento'));
      const alerta = await screen.findByRole('alert');
      expect(alerta).toHaveTextContent(esperado);
      if (crudo) expect(alerta).not.toHaveTextContent(crudo);
      expect(boton('Cargar documento')).toBeEnabled();
    });

    it('un 400 de validación señala el campo, lo enlaza con su error y le da el foco', async () => {
      const usuario = userEvent.setup();
      montar({
        'POST /documentos': () =>
          respuestaJson({ message: 'Datos inválidos', problemas: ['expediente: no puede pasar de 60 caracteres'] }, 400),
      });
      await screen.findByRole('heading', { level: 1, name: 'Cargar un documento' });
      await llenarFormularioDeCarga(usuario);
      await usuario.click(boton('Cargar documento'));
      const campo = screen.getByLabelText(/^Expediente/);
      await waitFor(() => expect(campo).toHaveFocus());
      expect(campo).toHaveAttribute('aria-invalid', 'true');
      expect(campo).toHaveAccessibleDescription(/El expediente no puede pasar de 60 caracteres/);
    });

    it('sin red: lo dice y recuerda que lo que llegó no se duplicará', async () => {
      const usuario = userEvent.setup();
      montar({ 'POST /documentos': () => Promise.reject(new TypeError('Failed to fetch')) as unknown as Response });
      await screen.findByRole('heading', { level: 1, name: 'Cargar un documento' });
      await llenarFormularioDeCarga(usuario);
      await usuario.click(boton('Cargar documento'));
      const alerta = await screen.findByRole('alert');
      expect(alerta).toHaveTextContent('No se pudo conectar con el servidor');
      expect(alerta).toHaveTextContent('no se duplicará');
    });

    it('la alerta recibe el foco para que se note con teclado o lector de pantalla', async () => {
      const usuario = userEvent.setup();
      montar({ 'POST /documentos': () => respuestaJson({ message: 'x' }, 500) });
      await screen.findByRole('heading', { level: 1, name: 'Cargar un documento' });
      await llenarFormularioDeCarga(usuario);
      await usuario.click(boton('Cargar documento'));
      expect(await screen.findByRole('alert')).toHaveFocus();
    });

    it('una sesión terminada (401) devuelve al ingreso', async () => {
      const usuario = userEvent.setup();
      montar({ 'POST /documentos': () => respuestaJson({ statusCode: 401, message: 'Se requiere iniciar sesión' }, 401) });
      await screen.findByRole('heading', { level: 1, name: 'Cargar un documento' });
      await llenarFormularioDeCarga(usuario);
      await usuario.click(boton('Cargar documento'));
      expect(await screen.findByRole('heading', { name: 'Ingreso' })).toBeInTheDocument();
      expect(screen.getByText(/Tu sesión terminó/)).toBeInTheDocument();
    });

    it('si el cuadro de clasificación no carga, lo dice y deja reintentar', async () => {
      const usuario = userEvent.setup();
      let falla = true;
      montar({ 'GET /series': () => (falla ? respuestaJson({ message: 'x' }, 500) : respuestaJson(CUADRO)) });
      expect(await screen.findByText(/No se pudo cargar el cuadro de clasificación/)).toBeInTheDocument();
      falla = false;
      await usuario.click(screen.getByRole('button', { name: 'Reintentar' }));
      await waitFor(() => expect(within(screen.getByLabelText(/^Subserie/)).getAllByRole('option')).toHaveLength(4));
    });
  });

  describe('duplicado exacto (409): no se puede cargar', () => {
    it('dice dónde está el documento y por qué, con enlace; no ofrece decidir nada', async () => {
      const usuario = userEvent.setup();
      const api = montar({ 'POST /documentos': () => respuestaJson(cuerpoDeExacto(), 409) });
      await screen.findByRole('heading', { level: 1, name: 'Cargar un documento' });
      await llenarFormularioDeCarga(usuario);
      await usuario.click(boton('Cargar documento'));

      const aviso = await screen.findByRole('alert');
      expect(within(aviso).getByRole('heading', { name: 'Este archivo ya está en el sistema' })).toBeInTheDocument();
      expect(aviso).toHaveTextContent('versión 2 del documento «Contrato de obra 7»');
      expect(aviso).toHaveTextContent('expediente EXP-100');
      expect(aviso).toHaveTextContent('100-01 · Contratos de obra');
      expect(aviso).toHaveTextContent('no se puede cargar dos veces');
      expect(within(aviso).getByRole('link', { name: 'Abrir el documento «Contrato de obra 7»' })).toHaveAttribute('href', '/documentos/7');
      expect(aviso).toHaveFocus();
      expect(screen.queryByRole('radio')).not.toBeInTheDocument();
      expect(api.a('POST', '/documentos')).toHaveLength(1);
      expect(boton('Cargar documento')).toBeEnabled();
    });
  });
});

describe('duplicado probable (409): la pantalla de comparación', () => {
  /** La API de un documento 7 que ya existe: avisa de duplicado probable si no hay decisión y carga si la hay. */
  function conDuplicado(extra: Manejadores = {}) {
    return montar({
      'POST /documentos': (llamada) =>
        llamada.formulario?.get('decision') ? respuestaDeCreado() : respuestaJson(cuerpoDeProbable(), 409),
      'GET /documentos/7': () => respuestaJson(documentoExistente()),
      ...extra,
    });
  }

  async function hastaLaComparacion(usuario: ReturnType<typeof userEvent.setup>, datos: Parameters<typeof llenarFormularioDeCarga>[1] = {}) {
    await screen.findByRole('heading', { level: 1, name: 'Cargar un documento' });
    await llenarFormularioDeCarga(usuario, datos);
    await usuario.click(boton('Cargar documento'));
    return screen.findByRole('heading', { level: 2, name: 'Este archivo se parece a un documento que ya existe' });
  }

  it('muestra el documento que ya existe y el que se intenta cargar, lado a lado, con sus datos', async () => {
    const usuario = userEvent.setup();
    conDuplicado();
    const titulo = await hastaLaComparacion(usuario, {
      archivo: archivoPdf('escaneo-nuevo.pdf', 3 * 1024 * 1024),
      titulo: 'Contrato de obra reescaneado',
      expediente: 'EXP-2026-031',
      fecha: '2026-03-15',
    });
    expect(titulo).toHaveFocus();

    const existe = screen.getByRole('region', { name: 'Contrato de obra 7' });
    expect(existe).toHaveTextContent('Ya existe en el sistema');
    expect(existe).toHaveTextContent('93 % de parecido en el texto');
    expect(existe).toHaveTextContent('el aviso salta desde 80 %');
    expect(existe).toHaveTextContent('EXP-100');
    expect(existe).toHaveTextContent('100-01 · Contratos de obra');
    // Los datos que no vienen en el aviso salen del detalle del documento.
    expect(await within(existe).findByText('10 de febrero de 2026')).toBeInTheDocument();
    expect(existe).toHaveTextContent('2 (la vigente)');
    expect(existe).toHaveTextContent('editor.demo');
    expect(existe).toHaveTextContent(/Cargada el.*2026/);
    expect(within(existe).getByRole('link', { name: /Ver el documento/ })).toHaveAttribute('href', '/documentos/7');
    expect(within(existe).getByRole('link', { name: /Ver el documento/ })).toHaveAttribute('target', '_blank');
    expect(within(existe).getByRole('link', { name: 'Descargar la versión 2 (PDF)' })).toHaveAttribute('href', '/documentos/7/versiones/2/archivo');

    const nuevo = screen.getByRole('region', { name: 'Contrato de obra reescaneado' });
    expect(nuevo).toHaveTextContent('Lo que intentas cargar');
    expect(nuevo).toHaveTextContent('escaneo-nuevo.pdf');
    expect(nuevo).toHaveTextContent('3,0 MB');
    expect(nuevo).toHaveTextContent('EXP-2026-031');
    expect(nuevo).toHaveTextContent('100-01 · Contratos de obra');
    expect(nuevo).toHaveTextContent('15 de marzo de 2026');
  });

  it('abre el PDF nuevo en otra pestaña con una dirección blob: y no incrusta ningún PDF', async () => {
    const usuario = userEvent.setup();
    conDuplicado();
    const archivo = archivoPdf('escaneo-nuevo.pdf');
    await hastaLaComparacion(usuario, { archivo });
    const enlace = await screen.findByRole('link', { name: /Abrir el PDF nuevo/ });
    expect(enlace).toHaveAttribute('href', 'blob:prueba/archivo-nuevo');
    expect(enlace).toHaveAttribute('target', '_blank');
    expect(enlace.getAttribute('rel')).toContain('noopener');
    expect(crearDireccionFalsa).toHaveBeenCalledWith(expect.objectContaining({ name: 'escaneo-nuevo.pdf' }));
    // La política de contenido de la API no permite incrustar: no hay iframe, object ni embed.
    expect(document.querySelector('iframe, object, embed')).toBeNull();
  });

  it('libera la dirección blob al volver al formulario', async () => {
    const usuario = userEvent.setup();
    conDuplicado();
    await hastaLaComparacion(usuario);
    await screen.findByRole('link', { name: /Abrir el PDF nuevo/ });
    await usuario.click(boton('Volver y corregir los datos'));
    expect(liberarDireccionFalsa).toHaveBeenCalledWith('blob:prueba/archivo-nuevo');
  });

  it('ofrece las tres decisiones y dice qué pasará con cada una', async () => {
    const usuario = userEvent.setup();
    conDuplicado();
    await hastaLaComparacion(usuario);
    const mismo = screen.getByRole('radio', { name: 'Es el mismo documento: no cargar nada' });
    const nueva = screen.getByRole('radio', { name: 'Es una versión nueva de «Contrato de obra 7»' });
    const otro = screen.getByRole('radio', { name: 'Es otro documento: cargarlo de todos modos' });
    expect(mismo).toHaveAccessibleDescription(/No se guarda este archivo y no cambia nada/);
    expect(nueva).toHaveAccessibleDescription(/versión más del documento que ya existe y pasa a ser la vigente/);
    expect(nueva).toHaveAccessibleDescription(/Las versiones anteriores quedan en el historial/);
    expect(otro).toHaveAccessibleDescription(/Se crea un documento nuevo con los datos que escribiste/);
    expect(otro).toHaveAccessibleDescription(/queda registrada en la auditoría/);
    expect(mismo).not.toBeChecked();
    expect(nueva).not.toBeChecked();
    expect(otro).not.toBeChecked();
  });

  it('sin elegir una decisión, confirmar pide elegir y no envía nada', async () => {
    const usuario = userEvent.setup();
    const api = conDuplicado();
    await hastaLaComparacion(usuario);
    await usuario.click(boton('Confirmar mi decisión'));
    expect(screen.getByText('Elige qué quieres hacer con este archivo.')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Es el mismo documento/ })).toHaveFocus();
    expect(api.a('POST', '/documentos')).toHaveLength(1);
  });

  it('«es el mismo documento»: no se carga nada y se lleva al documento que ya existe', async () => {
    const usuario = userEvent.setup();
    const api = conDuplicado();
    await hastaLaComparacion(usuario);
    await usuario.click(screen.getByRole('radio', { name: /Es el mismo documento/ }));
    await usuario.click(boton('No cargar el archivo'));

    expect(await screen.findByRole('heading', { level: 1, name: 'Contrato de obra 7' })).toBeInTheDocument();
    expect(ubicacion()).toHaveTextContent('/documentos/7');
    expect(screen.getByText('No se cargó nada: el archivo ya estaba en el sistema como «Contrato de obra 7».')).toBeInTheDocument();
    expect(api.a('POST', '/documentos')).toHaveLength(1);
  });

  describe('«es una versión nueva»', () => {
    it('exige el motivo y no envía mientras falte', async () => {
      const usuario = userEvent.setup();
      const api = conDuplicado();
      await hastaLaComparacion(usuario);
      await usuario.click(screen.getByRole('radio', { name: /Es una versión nueva/ }));
      await usuario.click(boton('Agregar como versión nueva'));
      expect(screen.getByText('Escribe el motivo: explica qué cambió respecto a la versión que ya existe.')).toBeInTheDocument();
      const motivo = screen.getByLabelText(/^Motivo de la versión nueva/);
      expect(motivo).toHaveAttribute('aria-invalid', 'true');
      expect(motivo).toHaveFocus();
      expect(api.a('POST', '/documentos')).toHaveLength(1);

      await usuario.type(motivo, '    ');
      await usuario.click(boton('Agregar como versión nueva'));
      expect(api.a('POST', '/documentos')).toHaveLength(1);
    });

    it('reenvía el mismo archivo con decision, documentoId y motivo, y lleva al documento con la versión nueva', async () => {
      const usuario = userEvent.setup();
      const api = conDuplicado({
        'POST /documentos': (llamada) =>
          llamada.formulario?.get('decision')
            ? respuestaJson({ documento: { ...documentoExistente(), versiones: undefined }, version: { ...documentoExistente().versiones[0], numero: 3 } }, 201)
            : respuestaJson(cuerpoDeProbable(), 409),
      });
      await hastaLaComparacion(usuario, { archivo: archivoPdf('escaneo-nuevo.pdf'), titulo: 'Contrato de obra reescaneado' });
      await usuario.click(screen.getByRole('radio', { name: /Es una versión nueva/ }));
      await usuario.type(screen.getByLabelText(/^Motivo de la versión nueva/), '  Reescaneo con mejor calidad  ');
      await usuario.click(boton('Agregar como versión nueva'));

      expect(await screen.findByRole('heading', { level: 1, name: 'Contrato de obra 7' })).toBeInTheDocument();
      const llamadas = api.a('POST', '/documentos');
      expect(llamadas).toHaveLength(2);
      expect(enviado(llamadas[1])).toEqual({
        titulo: 'Contrato de obra reescaneado',
        expediente: 'EXP-2026-031',
        serieId: '11',
        fechaDocumento: '2026-03-15',
        decision: 'nueva_version',
        documentoId: '7',
        motivo: 'Reescaneo con mejor calidad',
        archivo: 'archivo:escaneo-nuevo.pdf',
      });
      expect(screen.getByText(/Se agregó el archivo como la versión 3 del documento «Contrato de obra 7»/)).toBeInTheDocument();
    });
  });

  describe('«es otro documento»', () => {
    it('exige la justificación y no envía mientras falte', async () => {
      const usuario = userEvent.setup();
      const api = conDuplicado();
      await hastaLaComparacion(usuario);
      await usuario.click(screen.getByRole('radio', { name: /Es otro documento/ }));
      await usuario.click(boton('Cargar como documento nuevo'));
      expect(screen.getByText('Escribe la justificación: explica por qué no es un duplicado.')).toBeInTheDocument();
      const justificacion = screen.getByLabelText(/^Justificación/);
      expect(justificacion).toHaveAttribute('aria-invalid', 'true');
      expect(justificacion).toHaveFocus();
      expect(api.a('POST', '/documentos')).toHaveLength(1);

      await usuario.type(justificacion, '   ');
      await usuario.click(boton('Cargar como documento nuevo'));
      expect(api.a('POST', '/documentos')).toHaveLength(1);
    });

    it('reenvía el mismo archivo con decision y justificacion, sin documentoId, y lleva al documento nuevo', async () => {
      const usuario = userEvent.setup();
      const api = conDuplicado();
      await hastaLaComparacion(usuario, { archivo: archivoPdf('escaneo-nuevo.pdf'), titulo: 'Contrato del lote 2', motivo: 'Lote 2' });
      await usuario.click(screen.getByRole('radio', { name: /Es otro documento/ }));
      await usuario.type(screen.getByLabelText(/^Justificación/), '  Es el contrato del segundo lote  ');
      await usuario.click(boton('Cargar como documento nuevo'));

      expect(await screen.findByRole('heading', { level: 1, name: 'Acta de comité 12' })).toBeInTheDocument();
      const llamadas = api.a('POST', '/documentos');
      expect(llamadas).toHaveLength(2);
      const reenviado = enviado(llamadas[1]);
      expect(reenviado).toEqual({
        titulo: 'Contrato del lote 2',
        expediente: 'EXP-2026-031',
        serieId: '11',
        fechaDocumento: '2026-03-15',
        motivo: 'Lote 2',
        decision: 'documento_distinto',
        justificacion: 'Es el contrato del segundo lote',
        archivo: 'archivo:escaneo-nuevo.pdf',
      });
      expect(reenviado).not.toHaveProperty('documentoId');
      expect(ubicacion()).toHaveTextContent('/documentos/31');
    });
  });

  it('cambiar de decisión no arrastra los campos de la otra', async () => {
    const usuario = userEvent.setup();
    conDuplicado();
    await hastaLaComparacion(usuario);
    await usuario.click(screen.getByRole('radio', { name: /Es una versión nueva/ }));
    expect(screen.getByLabelText(/^Motivo de la versión nueva/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Justificación/)).not.toBeInTheDocument();
    await usuario.click(screen.getByRole('radio', { name: /Es otro documento/ }));
    expect(screen.queryByLabelText(/^Motivo de la versión nueva/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Justificación/)).toBeInTheDocument();
  });

  it('«Volver y corregir» regresa al formulario con lo escrito y el archivo elegido, y el foco al título', async () => {
    const usuario = userEvent.setup();
    conDuplicado();
    await hastaLaComparacion(usuario, { titulo: 'Contrato de obra reescaneado' });
    await usuario.click(boton('Volver y corregir los datos'));
    expect(screen.queryByRole('heading', { name: 'Este archivo se parece a un documento que ya existe' })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Título/)).toHaveValue('Contrato de obra reescaneado');
    expect((screen.getByLabelText(/Archivo PDF/) as HTMLInputElement).files?.[0]?.name).toBe('escaneo-nuevo.pdf');
    expect(screen.getByRole('heading', { level: 1, name: 'Cargar un documento' })).toHaveFocus();
  });

  describe('si la decisión falla', () => {
    it('muestra el error en la pantalla de comparación, sin perder lo escrito, y deja volver a intentar', async () => {
      const usuario = userEvent.setup();
      let intento = 0;
      const api = conDuplicado({
        'POST /documentos': (llamada) => {
          if (!llamada.formulario?.get('decision')) return respuestaJson(cuerpoDeProbable(), 409);
          return ++intento === 1 ? respuestaJson({ statusCode: 404, message: 'No existe el documento 7' }, 404) : respuestaDeCreado();
        },
      });
      await hastaLaComparacion(usuario);
      await usuario.click(screen.getByRole('radio', { name: /Es una versión nueva/ }));
      await usuario.type(screen.getByLabelText(/^Motivo de la versión nueva/), 'Mejor calidad');
      await usuario.click(boton('Agregar como versión nueva'));

      const alerta = await screen.findByRole('alert');
      expect(alerta).toHaveTextContent('La subserie o el documento elegido ya no existe');
      expect(alerta).toHaveFocus();
      expect(screen.getByLabelText(/^Motivo de la versión nueva/)).toHaveValue('Mejor calidad');
      expect(boton('Agregar como versión nueva')).toBeEnabled();

      await usuario.click(screen.getByRole('radio', { name: /Es otro documento/ }));
      await usuario.type(screen.getByLabelText(/^Justificación/), 'Otro lote');
      await usuario.click(boton('Cargar como documento nuevo'));
      await screen.findByRole('heading', { level: 1, name: 'Acta de comité 12' });
      expect(api.a('POST', '/documentos')).toHaveLength(3);
    });

    it('mientras se envía la decisión, todo queda deshabilitado y no se envía dos veces', async () => {
      const usuario = userEvent.setup();
      let terminar: (r: Response) => void = () => undefined;
      const api = conDuplicado({
        'POST /documentos': (llamada) =>
          llamada.formulario?.get('decision')
            ? new Promise<Response>((resolver) => (terminar = resolver))
            : respuestaJson(cuerpoDeProbable(), 409),
      });
      await hastaLaComparacion(usuario);
      await usuario.click(screen.getByRole('radio', { name: /Es otro documento/ }));
      await usuario.type(screen.getByLabelText(/^Justificación/), 'Otro lote');
      await usuario.click(boton('Cargar como documento nuevo'));

      const enCurso = await screen.findByRole('button', { name: 'Guardando…' });
      expect(enCurso).toBeDisabled();
      expect(boton('Volver y corregir los datos')).toBeDisabled();
      expect(screen.getByRole('radio', { name: /Es el mismo documento/ })).toBeDisabled();
      expect(screen.getByLabelText(/^Justificación/)).toBeDisabled();
      await usuario.click(enCurso);
      expect(api.a('POST', '/documentos')).toHaveLength(2);
      terminar(respuestaDeCreado());
      await screen.findByRole('heading', { level: 1, name: 'Acta de comité 12' });
    });

    it('si otra persona cargó entre tanto el mismo archivo (409 exacto), vuelve al formulario y lo explica', async () => {
      const usuario = userEvent.setup();
      conDuplicado({
        'POST /documentos': (llamada) =>
          llamada.formulario?.get('decision') ? respuestaJson(cuerpoDeExacto(), 409) : respuestaJson(cuerpoDeProbable(), 409),
      });
      await hastaLaComparacion(usuario);
      await usuario.click(screen.getByRole('radio', { name: /Es otro documento/ }));
      await usuario.type(screen.getByLabelText(/^Justificación/), 'Otro lote');
      await usuario.click(boton('Cargar como documento nuevo'));

      const aviso = await screen.findByRole('alert');
      expect(within(aviso).getByRole('heading', { name: 'Este archivo ya está en el sistema' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Este archivo se parece a un documento que ya existe' })).not.toBeInTheDocument();
    });
  });

  it('si el detalle del documento existente no carga, avisa pero deja decidir con lo que hay', async () => {
    const usuario = userEvent.setup();
    const api = conDuplicado({ 'GET /documentos/7': () => respuestaJson({ message: 'x' }, 500) });
    await hastaLaComparacion(usuario);
    expect(await screen.findByText(/No se pudieron cargar la fecha ni el autor/)).toBeInTheDocument();
    await usuario.click(screen.getByRole('radio', { name: /Es otro documento/ }));
    await usuario.type(screen.getByLabelText(/^Justificación/), 'Otro lote');
    await usuario.click(boton('Cargar como documento nuevo'));
    await screen.findByRole('heading', { level: 1, name: 'Acta de comité 12' });
    expect(api.a('POST', '/documentos')).toHaveLength(2);
  });

  describe('con varios candidatos', () => {
    const OTRO = { documentoId: 9, version: 1, titulo: 'Contrato de obra 9', expediente: 'EXP-101', serieCodigo: '100-02', similitud: 0.85 };

    it('deja elegir con cuál comparar, y la decisión usa el documento elegido', async () => {
      const usuario = userEvent.setup();
      const api = conDuplicado({
        'POST /documentos': (llamada) =>
          llamada.formulario?.get('decision') ? respuestaDeCreado() : respuestaJson(cuerpoDeProbable([CANDIDATO, OTRO]), 409),
        'GET /documentos/9': () => respuestaJson({ ...documentoExistente(), id: 9, titulo: 'Contrato de obra 9', versiones: [documentoExistente().versiones[1]] }),
      });
      await hastaLaComparacion(usuario);
      expect(screen.getByRole('group', { name: 'Elige con cuál quieres comparar' })).toBeInTheDocument();
      const primero = screen.getByRole('radio', { name: /Contrato de obra 7.*93 %/ });
      expect(primero).toBeChecked();
      expect(screen.getByRole('radio', { name: /Contrato de obra 9.*85 %/ })).not.toBeChecked();
      expect(screen.getByRole('region', { name: 'Contrato de obra 7' })).toBeInTheDocument();

      await usuario.click(screen.getByRole('radio', { name: /Contrato de obra 9.*85 %/ }));
      expect(await screen.findByRole('region', { name: 'Contrato de obra 9' })).toHaveTextContent('85 % de parecido');
      expect(screen.getByRole('region', { name: 'Contrato de obra 9' })).toHaveTextContent('100-02 · Interventoría');
      expect(screen.queryByRole('region', { name: 'Contrato de obra 7' })).not.toBeInTheDocument();

      await usuario.click(screen.getByRole('radio', { name: 'Es una versión nueva de «Contrato de obra 9»' }));
      await usuario.type(screen.getByLabelText(/^Motivo de la versión nueva/), 'Reescaneo');
      await usuario.click(boton('Agregar como versión nueva'));
      await waitFor(() => expect(api.a('POST', '/documentos')).toHaveLength(2));
      expect(enviado(api.a('POST', '/documentos')[1])).toMatchObject({ decision: 'nueva_version', documentoId: '9' });
    });
  });
});

describe('permisos por rol en la carga', () => {
  it('el rol de consulta no ve el enlace del menú ni entra por la dirección: no se pide nada de la carga', async () => {
    const api = montar({}, 'consulta');
    expect(await screen.findByRole('heading', { name: /No tienes permiso/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Cargar documento' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Archivo PDF/)).not.toBeInTheDocument();
    expect(api.a('GET', '/series')).toHaveLength(0);
    expect(api.a('POST', '/documentos')).toHaveLength(0);
  });

  it.each(['editor', 'administrador'] as const)('%s ve el enlace «Cargar documento» y entra a la pantalla', async (rol) => {
    montar({}, rol);
    expect(await screen.findByRole('heading', { level: 1, name: 'Cargar un documento' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Cargar documento' })).toHaveAttribute('href', '/documentos/nuevo');
  });
});
