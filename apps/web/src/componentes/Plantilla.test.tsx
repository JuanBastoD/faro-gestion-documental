import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CUADRO, manejadoresDeSesion, renderizarApp, respuestaJson, simularApi } from '../pruebas/ayudas';

async function menuDe(rol: 'consulta' | 'editor' | 'administrador') {
  simularApi({
    ...manejadoresDeSesion(rol),
    'GET /series': () => respuestaJson(CUADRO),
    'GET /documentos': () => respuestaJson({ items: [], total: 0, pagina: 1, tamano: 10 }),
  });
  renderizarApp('/documentos');
  const menu = await screen.findByRole('navigation', { name: 'Principal' });
  return within(menu)
    .getAllByRole('link')
    .map((enlace) => enlace.textContent);
}

describe('menú según el rol', () => {
  it('consulta: solo documentos (no ve cargar, usuarios ni auditoría)', async () => {
    expect(await menuDe('consulta')).toEqual(['Documentos']);
  });

  it('editor: documentos y cargar', async () => {
    expect(await menuDe('editor')).toEqual(['Documentos', 'Cargar documento']);
  });

  it('administrador: todo, incluidos usuarios y auditoría', async () => {
    expect(await menuDe('administrador')).toEqual(['Documentos', 'Cargar documento', 'Usuarios', 'Auditoría']);
  });

  it('muestra quién tiene la sesión y su rol', async () => {
    await menuDe('editor');
    expect(screen.getByText('Editor Demo')).toBeInTheDocument();
    expect(screen.getByText('Editor', { selector: '.sesion__rol' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeInTheDocument();
  });

  it('marca la pantalla actual y ofrece saltar al contenido', async () => {
    await menuDe('consulta');
    expect(screen.getByRole('link', { name: 'Documentos' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Saltar al contenido' })).toHaveAttribute('href', '#contenido');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'contenido');
  });
});
