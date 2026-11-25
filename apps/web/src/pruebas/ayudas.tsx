import { render } from '@testing-library/react';
import { vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router';
import { App } from '../App';
import type { Rol, UsuarioSesion } from '../api/auth';
import type { ResumenDocumento } from '../api/documentos';
import type { Serie } from '../api/series';
import { ProveedorSesion } from '../sesion/ProveedorSesion';

/** Una respuesta JSON como la que daría la API. */
export function respuestaJson(cuerpo: unknown, estado = 200, cabeceras: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'Content-Type': 'application/json', ...cabeceras },
  });
}

export interface Llamada {
  metodo: string;
  ruta: string;
  consulta: URLSearchParams;
  /** El cuerpo JSON, si la petición lo trae. */
  cuerpo: unknown;
  /** El formulario multipart (carga de PDF), si la petición lo trae. */
  formulario: FormData | undefined;
}

export type Manejador = (llamada: Llamada) => Response | Promise<Response>;

/**
 * Sustituye `fetch` por una API de mentira. Cada manejador atiende «MÉTODO /ruta» (sin la cadena de consulta). Una
 * ruta sin manejador responde 500 a propósito: una pantalla que pide algo que la prueba no previó debe notarse.
 */
export function simularApi(manejadores: Record<string, Manejador>) {
  const llamadas: Llamada[] = [];
  const fetchFalso = vi.fn(async (entrada: string, init?: RequestInit) => {
    const url = new URL(entrada, 'http://localhost');
    const metodo = (init?.method ?? 'GET').toUpperCase();
    const llamada: Llamada = {
      metodo,
      ruta: url.pathname,
      consulta: url.searchParams,
      cuerpo: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      formulario: init?.body instanceof FormData ? init.body : undefined,
    };
    llamadas.push(llamada);
    const manejador = manejadores[`${metodo} ${url.pathname}`];
    if (!manejador) return respuestaJson({ message: `La prueba no previó ${metodo} ${url.pathname}` }, 500);
    return manejador(llamada);
  });
  vi.stubGlobal('fetch', fetchFalso);
  return {
    llamadas,
    fetchFalso,
    /** Las llamadas a una ruta, en orden. */
    a: (metodo: string, ruta: string) => llamadas.filter((l) => l.metodo === metodo && l.ruta === ruta),
  };
}

export function usuarioDePrueba(rol: Rol): UsuarioSesion {
  const nombres: Record<Rol, string> = { administrador: 'Admin Demo', editor: 'Editor Demo', consulta: 'Consulta Demo' };
  return { id: 1, usuario: `${rol}.demo`, nombre: nombres[rol], rol };
}

/** Manejadores de una sesión abierta (`GET /auth/yo`) o ninguna (401, como responde la API real). */
export function manejadoresDeSesion(rol: Rol | null): Record<string, Manejador> {
  return {
    'GET /auth/yo': () =>
      rol
        ? respuestaJson({ usuario: usuarioDePrueba(rol) })
        : respuestaJson({ statusCode: 401, message: 'Se requiere iniciar sesión', error: 'Unauthorized' }, 401),
    'POST /auth/logout': () => new Response(null, { status: 204 }),
  };
}

export const CUADRO: Serie[] = [
  {
    id: 1,
    codigo: '100',
    nombre: 'Gestión contractual',
    subseries: [
      { id: 11, codigo: '100-01', nombre: 'Contratos de obra' },
      { id: 12, codigo: '100-02', nombre: 'Interventoría' },
    ],
  },
  { id: 2, codigo: '200', nombre: 'Gestión administrativa', subseries: [{ id: 21, codigo: '200-01', nombre: 'Actas' }] },
];

export function documentoDePrueba(id: number, cambios: Partial<ResumenDocumento> = {}): ResumenDocumento {
  return {
    id,
    titulo: `Documento ${id}`,
    expediente: `EXP-2026-${String(id).padStart(3, '0')}`,
    serieId: 11,
    serieCodigo: '100-01',
    fechaDocumento: '2026-03-15',
    creadoPor: 1,
    creadoEn: '2026-11-20T15:30:00.000Z',
    versionActual: 1,
    ...cambios,
  };
}

/**
 * Un PDF de mentira para elegirlo en un campo de archivo. Con `tamano` declara ese tamaño sin reservar la memoria
 * (para probar el límite de 20 MB sin crear un archivo de 21 MB).
 */
export function archivoPdf(nombre = 'acta.pdf', tamano?: number): File {
  const archivo = new File(['%PDF-1.4\n% contenido ficticio\n'], nombre, { type: 'application/pdf' });
  if (tamano !== undefined) Object.defineProperty(archivo, 'size', { value: tamano });
  return archivo;
}

/** Muestra dónde está el enrutador, para que las pruebas comprueben adónde navegó la interfaz. */
function UbicacionActual() {
  const ubicacion = useLocation();
  return (
    <output data-testid="ubicacion" data-estado={JSON.stringify(ubicacion.state ?? null)}>
      {ubicacion.pathname + ubicacion.search}
    </output>
  );
}

/**
 * Monta la aplicación completa (sesión, guarda y rutas) en una ruta. Las pantallas piden a la API simulada. La ruta puede
 * traer un `state` de navegación (así llega a una pantalla, por ejemplo, el aviso que deja la anterior).
 */
export function renderizarApp(ruta: string | { pathname: string; state: unknown }) {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <ProveedorSesion>
        <App />
      </ProveedorSesion>
      <UbicacionActual />
    </MemoryRouter>,
  );
}
