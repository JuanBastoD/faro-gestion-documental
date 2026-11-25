import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { ResumenDocumento } from '../api/documentos';
import {
  CUADRO,
  documentoDePrueba,
  manejadoresDeSesion,
  renderizarApp,
  respuestaJson,
  simularApi,
  type Llamada,
} from '../pruebas/ayudas';
import { TAMANO_DE_PAGINA } from './Documentos';

const ubicacion = () => screen.getByTestId('ubicacion').textContent;

/** La página `pagina` de una colección de `total` documentos, como la devolvería la API. */
function pagina(total: number, llamada: Llamada, items?: ResumenDocumento[]): Response {
  const numero = Number(llamada.consulta.get('pagina') ?? '1');
  const tamano = Number(llamada.consulta.get('tamano') ?? '20');
  const desde = (numero - 1) * tamano;
  const propios =
    items ??
    Array.from({ length: Math.max(0, Math.min(tamano, total - desde)) }, (_, i) => documentoDePrueba(total - (desde + i)));
  return respuestaJson({ items: propios, total, pagina: numero, tamano });
}

function montar(
  total: number,
  { rol = 'consulta', ruta = '/documentos' }: { rol?: 'consulta' | 'editor' | 'administrador'; ruta?: string } = {},
) {
  const api = simularApi({
    ...manejadoresDeSesion(rol),
    'GET /series': () => respuestaJson(CUADRO),
    'GET /documentos': (llamada) => pagina(total, llamada),
  });
  renderizarApp(ruta);
  return api;
}

describe('listado de documentos', () => {
  it('muestra los documentos con su expediente, serie (con nombre), fecha y versión', async () => {
    const api = simularApi({
      ...manejadoresDeSesion('consulta'),
      'GET /series': () => respuestaJson(CUADRO),
      'GET /documentos': () =>
        respuestaJson({
          items: [documentoDePrueba(7, { titulo: 'Acta de inicio del contrato', serieId: 12, serieCodigo: '100-02', versionActual: 3 })],
          total: 1,
          pagina: 1,
          tamano: 10,
        }),
    });
    renderizarApp('/documentos');

    const enlace = await screen.findByRole('link', { name: 'Acta de inicio del contrato' });
    expect(enlace).toHaveAttribute('href', '/documentos/7');
    const tarjeta = enlace.closest('li');
    expect(tarjeta).not.toBeNull();
    const dentro = within(tarjeta as HTMLElement);
    expect(dentro.getByText('EXP-2026-007')).toBeInTheDocument();
    expect(await dentro.findByText('100-02 · Interventoría')).toBeInTheDocument();
    expect(dentro.getByText(/15 de marzo de 2026/)).toBeInTheDocument();
    expect(dentro.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('1 documento')).toBeInTheDocument();
    expect(api.a('GET', '/documentos')[0].consulta.get('tamano')).toBe(String(TAMANO_DE_PAGINA));
  });

  describe('búsqueda', () => {
    it('al buscar pide q y la página 1, y lo deja en la URL', async () => {
      const usuario = userEvent.setup();
      const api = montar(0);
      await screen.findByText('Sin resultados');

      await usuario.type(screen.getByLabelText('Buscar'), 'interventoria');
      await usuario.click(screen.getByRole('button', { name: 'Buscar' }));

      await screen.findByText('Sin resultados para «interventoria»');
      const ultima = api.a('GET', '/documentos').at(-1);
      expect(ultima?.consulta.get('q')).toBe('interventoria');
      expect(ultima?.consulta.get('pagina')).toBe('1');
      expect(ubicacion()).toBe('/documentos?q=interventoria');
    });

    it('con Enter también busca, y recorta los espacios', async () => {
      const usuario = userEvent.setup();
      const api = montar(0);
      await screen.findByText('Sin resultados');
      await usuario.type(screen.getByLabelText('Buscar'), '  acta  {Enter}');
      await waitFor(() => expect(api.a('GET', '/documentos').at(-1)?.consulta.get('q')).toBe('acta'));
      expect(ubicacion()).toBe('/documentos?q=acta');
    });

    it('sin escribir nada no manda q', async () => {
      const api = montar(5);
      await screen.findByText('5 documentos');
      expect(api.a('GET', '/documentos')[0].consulta.has('q')).toBe(false);
    });

    it('buscar vuelve a la página 1 aunque se estuviera en otra', async () => {
      const usuario = userEvent.setup();
      const api = montar(35, { ruta: '/documentos?pagina=3' });
      await screen.findByText('Página 3 de 4');
      await usuario.type(screen.getByLabelText('Buscar'), 'acta');
      await usuario.click(screen.getByRole('button', { name: 'Buscar' }));
      await waitFor(() => expect(api.a('GET', '/documentos').at(-1)?.consulta.get('pagina')).toBe('1'));
      expect(ubicacion()).toBe('/documentos?q=acta');
    });

    it('lee la búsqueda, la serie y la página de la URL y rellena los controles', async () => {
      const api = montar(35, { ruta: '/documentos?q=acta&serieId=12&pagina=2' });
      await screen.findByText('Página 2 de 4');
      expect(screen.getByLabelText('Buscar')).toHaveValue('acta');
      expect(screen.getByLabelText('Serie')).toHaveValue('12');
      const llamada = api.a('GET', '/documentos').at(-1);
      expect(llamada?.consulta.get('q')).toBe('acta');
      expect(llamada?.consulta.get('serieId')).toBe('12');
      expect(llamada?.consulta.get('pagina')).toBe('2');
    });

    it('ignora valores inválidos de la URL en vez de mandárselos a la API', async () => {
      const api = montar(5, { ruta: '/documentos?serieId=abc&pagina=-3' });
      await screen.findByText('5 documentos');
      const llamada = api.a('GET', '/documentos')[0];
      expect(llamada.consulta.has('serieId')).toBe(false);
      expect(llamada.consulta.get('pagina')).toBe('1');
    });

    it('«Quitar filtros» limpia búsqueda y serie', async () => {
      const usuario = userEvent.setup();
      montar(5, { ruta: '/documentos?q=acta&serieId=12' });
      await screen.findByText('5 documentos para «acta»');
      await usuario.click(screen.getByRole('button', { name: 'Quitar filtros' }));
      await screen.findByText('5 documentos');
      expect(ubicacion()).toBe('/documentos');
      expect(screen.getByLabelText('Buscar')).toHaveValue('');
      expect(screen.getByLabelText('Serie')).toHaveValue('');
      expect(screen.queryByRole('button', { name: 'Quitar filtros' })).not.toBeInTheDocument();
    });
  });

  describe('filtro por serie', () => {
    it('ofrece las series del cuadro con sus subseries', async () => {
      montar(0);
      await screen.findByText('Sin resultados');
      const selector = screen.getByLabelText('Serie');
      await within(selector).findByRole('option', { name: '100-02 · Interventoría' });
      expect(within(selector).getByRole('option', { name: 'Todas las series' })).toBeInTheDocument();
      expect(within(selector).getByRole('option', { name: 'Toda la serie 100' })).toBeInTheDocument();
      expect(within(selector).getByRole('option', { name: '200-01 · Actas' })).toBeInTheDocument();
    });

    it('al elegir una subserie pide serieId, vuelve a la página 1 y lo deja en la URL', async () => {
      const usuario = userEvent.setup();
      const api = montar(35, { ruta: '/documentos?pagina=2' });
      await screen.findByText('Página 2 de 4');
      await within(screen.getByLabelText('Serie')).findByRole('option', { name: '100-02 · Interventoría' });

      await usuario.selectOptions(screen.getByLabelText('Serie'), '12');

      await waitFor(() => expect(api.a('GET', '/documentos').at(-1)?.consulta.get('serieId')).toBe('12'));
      expect(api.a('GET', '/documentos').at(-1)?.consulta.get('pagina')).toBe('1');
      expect(ubicacion()).toBe('/documentos?serieId=12');
    });

    it('elegir «Toda la serie» manda el id de la serie (la API incluye sus subseries)', async () => {
      const usuario = userEvent.setup();
      const api = montar(5);
      await screen.findByText('5 documentos');
      await within(screen.getByLabelText('Serie')).findByRole('option', { name: 'Toda la serie 100' });
      await usuario.selectOptions(screen.getByLabelText('Serie'), 'Toda la serie 100');
      await waitFor(() => expect(api.a('GET', '/documentos').at(-1)?.consulta.get('serieId')).toBe('1'));
    });

    it('vuelve a «Todas las series» sin mandar serieId', async () => {
      const usuario = userEvent.setup();
      const api = montar(5, { ruta: '/documentos?serieId=12' });
      await screen.findByText('5 documentos');
      await within(screen.getByLabelText('Serie')).findByRole('option', { name: 'Todas las series' });
      await usuario.selectOptions(screen.getByLabelText('Serie'), '');
      await waitFor(() => expect(api.a('GET', '/documentos').at(-1)?.consulta.has('serieId')).toBe(false));
      expect(ubicacion()).toBe('/documentos');
    });

    it('si el cuadro no carga, avisa y el listado sigue funcionando', async () => {
      simularApi({
        ...manejadoresDeSesion('consulta'),
        'GET /series': () => respuestaJson({ message: 'falla' }, 500),
        'GET /documentos': (llamada) => pagina(2, llamada),
      });
      renderizarApp('/documentos');
      expect(await screen.findByText(/No se pudo cargar el cuadro de clasificación/)).toBeInTheDocument();
      expect(await screen.findByText('2 documentos')).toBeInTheDocument();
    });
  });

  describe('paginación', () => {
    it('con 23 documentos hay 3 páginas; Anterior está desactivado en la primera', async () => {
      const api = montar(23);
      await screen.findByText('Página 1 de 3');
      expect(screen.getByText('23 documentos')).toBeInTheDocument();
      expect(screen.getAllByRole('listitem').filter((li) => li.classList.contains('tarjeta'))).toHaveLength(10);
      expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Siguiente' })).toBeEnabled();
      expect(api.a('GET', '/documentos')[0].consulta.get('pagina')).toBe('1');
    });

    it('Siguiente y Anterior piden la página que toca y la dejan en la URL', async () => {
      const usuario = userEvent.setup();
      const api = montar(23);
      await screen.findByText('Página 1 de 3');

      await usuario.click(screen.getByRole('button', { name: 'Siguiente' }));
      await screen.findByText('Página 2 de 3');
      expect(api.a('GET', '/documentos').at(-1)?.consulta.get('pagina')).toBe('2');
      expect(ubicacion()).toBe('/documentos?pagina=2');

      await usuario.click(screen.getByRole('button', { name: 'Siguiente' }));
      await screen.findByText('Página 3 de 3');
      expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
      // La última página trae lo que sobra: 23 - 20 = 3.
      expect(screen.getAllByRole('listitem').filter((li) => li.classList.contains('tarjeta'))).toHaveLength(3);

      await usuario.click(screen.getByRole('button', { name: 'Anterior' }));
      await screen.findByText('Página 2 de 3');
      expect(ubicacion()).toBe('/documentos?pagina=2');
    });

    it('no muestra paginación si todo cabe en una página', async () => {
      montar(10);
      await screen.findByText('10 documentos');
      expect(screen.queryByRole('navigation', { name: 'Paginación' })).not.toBeInTheDocument();
    });

    it('no repite ni pierde documentos entre páginas', async () => {
      const usuario = userEvent.setup();
      montar(23);
      const titulos = async () =>
        (await screen.findAllByRole('heading', { level: 2 })).map((h) => h.textContent);
      const todos: Array<string | null> = [...(await titulos())];
      for (const siguiente of [2, 3]) {
        await usuario.click(screen.getByRole('button', { name: 'Siguiente' }));
        await screen.findByText(`Página ${siguiente} de 3`);
        todos.push(...(await titulos()));
      }
      expect(todos).toHaveLength(23);
      expect(new Set(todos).size).toBe(23);
    });

    it('una página que ya no existe lleva a la última', async () => {
      const api = simularApi({
        ...manejadoresDeSesion('consulta'),
        'GET /series': () => respuestaJson(CUADRO),
        'GET /documentos': (llamada) =>
          Number(llamada.consulta.get('pagina')) > 3
            ? respuestaJson({ items: [], total: 23, pagina: Number(llamada.consulta.get('pagina')), tamano: 10 })
            : pagina(23, llamada),
      });
      renderizarApp('/documentos?pagina=9');
      await screen.findByText('Página 3 de 3');
      expect(ubicacion()).toBe('/documentos?pagina=3');
      expect(api.a('GET', '/documentos').map((l) => l.consulta.get('pagina'))).toEqual(['9', '3']);
    });
  });

  describe('estados', () => {
    it('sin documentos ni filtros: lo dice, y el editor ve cómo cargar el primero', async () => {
      montar(0, { rol: 'editor' });
      expect(await screen.findByText('Aún no hay documentos cargados.')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Cargar el primer documento' })).toHaveAttribute('href', '/documentos/nuevo');
    });

    it('sin documentos ni filtros: el rol de consulta no ve el enlace para cargar', async () => {
      montar(0, { rol: 'consulta' });
      expect(await screen.findByText('Aún no hay documentos cargados.')).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Cargar el primer documento' })).not.toBeInTheDocument();
    });

    it('sin coincidencias: lo dice y ofrece quitar los filtros', async () => {
      montar(0, { ruta: '/documentos?q=zzz' });
      expect(await screen.findByText(/Ningún documento coincide/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Quitar filtros' })).toBeInTheDocument();
    });

    it('error de la API: muestra el mensaje y «Reintentar» vuelve a pedir', async () => {
      const usuario = userEvent.setup();
      let falla = true;
      const api = simularApi({
        ...manejadoresDeSesion('consulta'),
        'GET /series': () => respuestaJson(CUADRO),
        'GET /documentos': (llamada) =>
          falla ? respuestaJson({ message: 'detalle interno' }, 500) : pagina(2, llamada),
      });
      renderizarApp('/documentos');
      const alerta = await screen.findByRole('alert');
      expect(alerta).toHaveTextContent(/El servidor tuvo un problema/);
      expect(alerta).not.toHaveTextContent('detalle interno');

      falla = false;
      await usuario.click(screen.getByRole('button', { name: 'Reintentar' }));
      expect(await screen.findByText('2 documentos')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(api.a('GET', '/documentos')).toHaveLength(2);
    });

    it('un parámetro que la API rechaza (400) muestra su mensaje', async () => {
      simularApi({
        ...manejadoresDeSesion('consulta'),
        'GET /series': () => respuestaJson(CUADRO),
        'GET /documentos': () => respuestaJson({ message: 'Parámetros inválidos: q no puede pasar de 200 caracteres', problemas: [] }, 400),
      });
      renderizarApp('/documentos');
      expect(await screen.findByRole('alert')).toHaveTextContent('Parámetros inválidos: q no puede pasar de 200 caracteres');
    });
  });

  it('una respuesta tardía de una búsqueda anterior no pisa a la actual', async () => {
    const usuario = userEvent.setup();
    let soltarLenta: (r: Response) => void = () => undefined;
    simularApi({
      ...manejadoresDeSesion('consulta'),
      'GET /series': () => respuestaJson(CUADRO),
      'GET /documentos': (llamada) => {
        if (llamada.consulta.get('q') === 'lenta') return new Promise<Response>((resolver) => (soltarLenta = resolver));
        if (llamada.consulta.get('q') === 'rapida') {
          return respuestaJson({ items: [documentoDePrueba(2, { titulo: 'Resultado rápido' })], total: 1, pagina: 1, tamano: 10 });
        }
        return pagina(0, llamada);
      },
    });
    renderizarApp('/documentos');
    await screen.findByText('Sin resultados');

    await usuario.type(screen.getByLabelText('Buscar'), 'lenta{Enter}');
    await screen.findByText('Cargando documentos…');
    await usuario.clear(screen.getByLabelText('Buscar'));
    await usuario.type(screen.getByLabelText('Buscar'), 'rapida{Enter}');
    await screen.findByText('Resultado rápido');

    soltarLenta(respuestaJson({ items: [documentoDePrueba(1, { titulo: 'Resultado lento' })], total: 1, pagina: 1, tamano: 10 }));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByText('Resultado rápido')).toBeInTheDocument();
    expect(screen.queryByText('Resultado lento')).not.toBeInTheDocument();
  });
});
