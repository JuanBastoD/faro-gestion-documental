import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { UsuarioSesion } from '../api/auth';
import { CUADRO, manejadoresDeSesion, renderizarApp, respuestaJson, simularApi } from '../pruebas/ayudas';

async function menuDe(rol: 'consulta' | 'editor' | 'administrador', extra: Partial<UsuarioSesion> = {}) {
  simularApi({
    ...manejadoresDeSesion(rol, extra),
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
  it('consulta: documentos y su propia clave (no ve cargar, usuarios ni auditoría)', async () => {
    expect(await menuDe('consulta')).toEqual(['Documentos', 'Mi clave']);
  });

  it('editor: documentos, cargar y su propia clave', async () => {
    expect(await menuDe('editor')).toEqual(['Documentos', 'Cargar documento', 'Mi clave']);
  });

  it('administrador: todo, incluidos usuarios y auditoría', async () => {
    expect(await menuDe('administrador')).toEqual(['Documentos', 'Cargar documento', 'Usuarios', 'Auditoría', 'Mi clave']);
  });

  it('«Mi clave» lleva a /clave, la pantalla de cambio voluntario', async () => {
    await menuDe('consulta');
    expect(screen.getByRole('link', { name: 'Mi clave' })).toHaveAttribute('href', '/clave');
  });

  it('con debeCambiarClave (clave temporal) no hay menú: solo se puede cambiarla o cerrar la sesión', async () => {
    simularApi({
      ...manejadoresDeSesion('administrador', { debeCambiarClave: true }),
      'GET /series': () => respuestaJson(CUADRO),
      'GET /documentos': () => respuestaJson({ items: [], total: 0, pagina: 1, tamano: 10 }),
    });
    renderizarApp('/documentos');
    await screen.findByRole('heading', { level: 1, name: 'Cambiar mi clave' });
    expect(screen.queryByRole('navigation', { name: 'Principal' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Usuarios' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeInTheDocument();
  });

  it('con debeCambiarClave en false el menú es el de siempre', async () => {
    expect(await menuDe('editor', { debeCambiarClave: false })).toEqual(['Documentos', 'Cargar documento', 'Mi clave']);
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
