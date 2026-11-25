/**
 * #51 (ADR-011): quién puede usar la API con una clave temporal. Recorre los controladores reales con los metadatos
 * de Nest (sin lista escrita a mano) para que una ruta o un decorador nuevo no abra nada sin que una prueba falle.
 *
 * - `@PermitidoConClaveTemporal()` nunca puede ir en una CLASE: `AuthGuard` lee método y clase, y en la clase
 *   abriría todas sus rutas a quien aún no cambió la clave (revisión C3, I-03).
 * - La lista de rutas permitidas es exactamente de tres y está fijada aquí: ampliarla es una decisión que se
 *   toma cambiando esta prueba y el ADR-011, no un efecto lateral.
 * - Toda ruta con sesión que no está en esa lista responde 403 `cambio_de_clave_requerido` a una persona con clave
 *   temporal, se haya escrito cuando se haya escrito.
 */
import type { INestApplication, Type } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { ModulesContainer, Reflector } from '@nestjs/core';
import request from 'supertest';
import {
  CLAVE_PERMITIDO_CON_CLAVE_TEMPORAL,
  CLAVE_PUBLICO,
} from '../src/auth/decoradores.js';
import { crearApp, crearUsuario, ingresar, limpiarTablas, type AppDePrueba } from './ayudas.js';

const CLAVE_TEMPORAL = 'temporal-de-rutas-246';

/** Los nombres que usa Nest para el método HTTP (`RequestMethod`). */
const METODOS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'OPTIONS', 'HEAD', 'SEARCH'] as const;

interface RutaDeControlador {
  /** «MÉTODO /ruta», igual que en `docs/matriz-de-roles.md`. */
  clave: string;
  controlador: string;
  publica: boolean;
  permitidaConClaveTemporal: boolean;
}

interface Controlador {
  clase: Type;
  /** El decorador puesto en la clase entera: lo que está prohibido. */
  permitidoEnLaClase: boolean;
  rutas: RutaDeControlador[];
}

const reflector = new Reflector();

/** La ruta de un controlador o de un método llega como texto o como lista de textos; vacía si no se indicó. */
const comoLista = (valor: string | string[] | undefined): string[] => (Array.isArray(valor) ? valor : [valor ?? '']);

function unirRuta(prefijo: string, ruta: string): string {
  const unida = `/${prefijo}/${ruta}`.replace(/\/{2,}/g, '/');
  return unida.length > 1 ? unida.replace(/\/$/, '') : unida;
}

/** Todos los controladores de la aplicación levantada, con sus rutas y los metadatos de las guardas. */
function recorrerControladores(app: INestApplication): Controlador[] {
  const clases = new Set<Type>();
  for (const modulo of app.get(ModulesContainer).values()) {
    for (const envoltorio of modulo.controllers.values()) {
      if (envoltorio.metatype) clases.add(envoltorio.metatype as Type);
    }
  }
  return [...clases].map((clase) => {
    const publicaLaClase = reflector.get<boolean | undefined>(CLAVE_PUBLICO, clase) === true;
    const rutas: RutaDeControlador[] = [];
    for (const nombre of Object.getOwnPropertyNames(clase.prototype)) {
      const manejador = (clase.prototype as Record<string, unknown>)[nombre];
      if (nombre === 'constructor' || typeof manejador !== 'function') continue;
      const metodo = reflector.get<number | undefined>(METHOD_METADATA, manejador);
      if (metodo === undefined) continue; // un método auxiliar, no una ruta
      for (const prefijo of comoLista(reflector.get<string | string[] | undefined>(PATH_METADATA, clase))) {
        for (const ruta of comoLista(reflector.get<string | string[] | undefined>(PATH_METADATA, manejador))) {
          rutas.push({
            clave: `${METODOS[metodo]} ${unirRuta(prefijo, ruta)}`,
            controlador: clase.name,
            publica: publicaLaClase || reflector.get<boolean | undefined>(CLAVE_PUBLICO, manejador) === true,
            permitidaConClaveTemporal:
              reflector.get<boolean | undefined>(CLAVE_PERMITIDO_CON_CLAVE_TEMPORAL, manejador) === true,
          });
        }
      }
    }
    return {
      clase,
      permitidoEnLaClase: reflector.get<boolean | undefined>(CLAVE_PERMITIDO_CON_CLAVE_TEMPORAL, clase) !== undefined,
      rutas,
    };
  });
}

describe('Rutas abiertas a quien tiene una clave temporal (contra la API completa)', () => {
  let ctx: AppDePrueba;
  let controladores: Controlador[];

  beforeAll(async () => {
    ctx = await crearApp();
    controladores = recorrerControladores(ctx.app);
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  const todasLasRutas = (): RutaDeControlador[] => controladores.flatMap((c) => c.rutas);

  /** Rutas que el servidor tiene registradas, como «MÉTODO /ruta» (igual que la prueba de la matriz de roles). */
  function rutasRegistradas(): string[] {
    interface Capa {
      route?: { path: string | RegExp; methods: Record<string, boolean> };
    }
    const express = ctx.app.getHttpAdapter().getInstance() as { router?: { stack: Capa[] }; _router?: { stack: Capa[] } };
    const rutas = new Set<string>();
    for (const capa of (express.router ?? express._router)?.stack ?? []) {
      if (!capa.route) continue;
      for (const metodo of Object.keys(capa.route.methods)) {
        if (['get', 'post', 'patch', 'put', 'delete'].includes(metodo)) rutas.add(`${metodo.toUpperCase()} ${String(capa.route.path)}`);
      }
    }
    return [...rutas].sort((a, b) => a.localeCompare(b));
  }

  it('el recorrido ve los mismos controladores y rutas que el servidor (si no, las demás pruebas no valdrían)', () => {
    const nombres = controladores.map((c) => c.clase.name);
    expect(nombres).toEqual(
      expect.arrayContaining([
        'AuditoriaController',
        'AuthController',
        'DocumentosController',
        'SaludController',
        'SeriesController',
        'UsuariosController',
        'VersionesController',
      ]),
    );
    const recorridas = todasLasRutas().map((r) => r.clave).sort((a, b) => a.localeCompare(b));
    expect(new Set(recorridas).size, 'hay rutas repetidas').toBe(recorridas.length);
    expect(recorridas).toEqual(rutasRegistradas());
  });

  it('@PermitidoConClaveTemporal() no está en ninguna CLASE: solo en métodos', () => {
    const enClases = controladores.filter((c) => c.permitidoEnLaClase).map((c) => c.clase.name);
    expect(enClases, 'ponerlo en una clase abre todas sus rutas a quien tiene clave temporal').toEqual([]);
  });

  it('las únicas rutas abiertas con clave temporal son exactamente tres: quién soy, cerrar sesión y cambiar la clave', () => {
    const permitidas = todasLasRutas()
      .filter((r) => r.permitidaConClaveTemporal)
      .map((r) => r.clave)
      .sort((a, b) => a.localeCompare(b));
    expect(permitidas).toEqual(['GET /auth/yo', 'POST /auth/clave', 'POST /auth/logout']);
  });

  it('ninguna ruta pública está marcada como permitida con clave temporal (no tiene sentido y esconde un error)', () => {
    expect(todasLasRutas().filter((r) => r.publica && r.permitidaConClaveTemporal)).toEqual([]);
  });

  it('toda ruta con sesión que no está en la lista responde 403 cambio_de_clave_requerido a quien tiene clave temporal', async () => {
    await limpiarTablas(ctx.pool);
    await crearUsuario(ctx.db, { usuario: 'admin', rol: 'administrador' });
    const idEditor = await crearUsuario(ctx.db, { usuario: 'editor', rol: 'editor' });
    const http = () => request(ctx.app.getHttpServer());
    const cookieAdmin = await ingresar(ctx.app, 'admin');
    await http()
      .post(`/usuarios/${idEditor}/clave`)
      .set('Cookie', cookieAdmin)
      .send({ clave: CLAVE_TEMPORAL })
      .expect(204);
    const cookie = await ingresar(ctx.app, 'editor', CLAVE_TEMPORAL);

    const cerradas = todasLasRutas().filter((r) => !r.publica && !r.permitidaConClaveTemporal);
    expect(cerradas.length).toBeGreaterThan(10);
    for (const ruta of cerradas) {
      const [metodo, ...resto] = ruta.clave.split(' ');
      const direccion = resto.join(' ').replace(/:\w+/g, '1');
      const peticion = http()[metodo.toLowerCase() as 'get' | 'post' | 'patch' | 'put' | 'delete'](direccion).set('Cookie', cookie);
      const respuesta = await (metodo === 'GET' ? peticion : peticion.send({}));
      expect(respuesta.status, `${ruta.clave} debería estar cerrada con clave temporal`).toBe(403);
      expect(respuesta.body, `${ruta.clave}`).toMatchObject({ codigo: 'cambio_de_clave_requerido' });
    }
  });
});
