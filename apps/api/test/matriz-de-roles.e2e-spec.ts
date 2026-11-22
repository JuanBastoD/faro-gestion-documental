/**
 * Verifica docs/matriz-de-roles.md contra la API real: cada celda de la matriz se prueba con un usuario
 * de cada rol y sin sesión, y las rutas que el servidor tiene registradas deben ser exactamente las de la tabla.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { CLAVE_DE_PRUEBA, crearApp, crearUsuario, ingresar, limpiarTablas, type AppDePrueba } from './ayudas.js';

const RUTA_DOCUMENTO = fileURLToPath(new URL('../../../docs/matriz-de-roles.md', import.meta.url));
const documento = readFileSync(RUTA_DOCUMENTO, 'utf8').replace(/\r\n/g, '\n');

interface Fila {
  metodo: string;
  ruta: string;
  permitido: { administrador: boolean; editor: boolean; consulta: boolean; sinSesion: boolean };
}

/** Las filas de la tabla de la sección 2: método, ruta y un Sí/No por rol y sin sesión. */
function leerMatriz(): Fila[] {
  const seccion = documento.slice(documento.indexOf('## 2. Matriz'), documento.indexOf('## 3. '));
  const filas: Fila[] = [];
  for (const linea of seccion.split('\n')) {
    if (!linea.startsWith('| ')) continue;
    const celdas = linea.replace(/^\||\|$/g, '').split('|').map((c) => c.trim().replace(/`/g, ''));
    if (!['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(celdas[0])) continue; // encabezado y separador
    const [metodo, ruta, , administrador, editor, consulta, sinSesion] = celdas;
    const si = (celda: string) => {
      if (celda !== 'Sí' && celda !== 'No') throw new Error(`Celda inválida «${celda}» en ${metodo} ${ruta}: debe ser Sí o No`);
      return celda === 'Sí';
    };
    filas.push({
      metodo,
      ruta,
      permitido: { administrador: si(administrador), editor: si(editor), consulta: si(consulta), sinSesion: si(sinSesion) },
    });
  }
  return filas;
}

const matriz = leerMatriz();

describe('docs/matriz-de-roles.md coincide con las guardas reales', () => {
  let ctx: AppDePrueba;

  beforeAll(async () => {
    ctx = await crearApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });
  beforeEach(async () => {
    await limpiarTablas(ctx.pool);
    await crearUsuario(ctx.db, { usuario: 'admin', rol: 'administrador' });
    await crearUsuario(ctx.db, { usuario: 'editor', rol: 'editor' });
    await crearUsuario(ctx.db, { usuario: 'lector', rol: 'consulta' });
  });

  /** Rutas que el servidor tiene registradas, como «MÉTODO /ruta» (sin OPTIONS ni HEAD). */
  function rutasRegistradas(): string[] {
    const express = ctx.app.getHttpAdapter().getInstance() as {
      router?: { stack: Capa[] };
      _router?: { stack: Capa[] };
    };
    const pila = (express.router ?? express._router)?.stack ?? [];
    const rutas = new Set<string>();
    for (const capa of pila) {
      if (!capa.route) continue;
      for (const metodo of Object.keys(capa.route.methods)) {
        if (!['get', 'post', 'patch', 'put', 'delete'].includes(metodo)) continue;
        rutas.add(`${metodo.toUpperCase()} ${String(capa.route.path)}`);
      }
    }
    return [...rutas].sort((a, b) => a.localeCompare(b));
  }
  interface Capa {
    route?: { path: string | RegExp; methods: Record<string, boolean> };
  }

  it('la tabla tiene filas y cada ruta registrada en el servidor está en la matriz, y al revés', () => {
    expect(matriz.length).toBeGreaterThan(10);
    const enMatriz = matriz.map((f) => `${f.metodo} ${f.ruta}`).sort((a, b) => a.localeCompare(b));
    expect(new Set(enMatriz).size, 'hay filas repetidas en la matriz').toBe(enMatriz.length);
    // Si falla: o un endpoint nuevo no está en docs/matriz-de-roles.md, o la matriz lista uno que ya no existe.
    expect(rutasRegistradas()).toEqual(enMatriz);
  });

  /** Una petición vacía a la ruta, con `:id` y `:numero` de algo que no existe: solo importa si las guardas la dejan pasar. */
  function probar(fila: Fila, cookie?: string) {
    const ruta = fila.ruta.replace(':id', '999999').replace(':numero', '1');
    const http = request(ctx.app.getHttpServer());
    let peticion =
      fila.metodo === 'GET' ? http.get(ruta) : fila.metodo === 'POST' ? http.post(ruta) : http.patch(ruta);
    if (cookie) peticion = peticion.set('Cookie', cookie);
    // El ingreso se prueba con credenciales válidas; el resto, con un cuerpo vacío.
    return fila.metodo === 'GET'
      ? peticion
      : peticion.send(fila.ruta === '/auth/login' ? { usuario: 'admin', clave: CLAVE_DE_PRUEBA } : {});
  }

  describe.each(matriz.map((f) => [`${f.metodo} ${f.ruta}`, f] as const))('%s', (_nombre, fila) => {
    it.each([
      ['administrador', 'admin'],
      ['editor', 'editor'],
      ['consulta', 'lector'],
    ] as const)('rol %s', async (rol, usuario) => {
      // Una sesión nueva por prueba: cerrar sesión (POST /auth/logout) acaba con la que se use.
      const cookie = await ingresar(ctx.app, usuario);
      const { status } = await probar(fila, cookie);
      if (fila.permitido[rol]) {
        expect([401, 403], `${rol} debería poder y recibió ${status}`).not.toContain(status);
      } else {
        expect(status, `${rol} no debería poder`).toBe(403);
      }
    });

    it('sin sesión', async () => {
      const { status } = await probar(fila);
      if (fila.permitido.sinSesion) {
        expect([401, 403], `sin sesión debería poder y recibió ${status}`).not.toContain(status);
      } else {
        expect(status, 'sin sesión no debería poder').toBe(401);
      }
    });
  });
});
