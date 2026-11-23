import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { Controller, Get, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configurarSeguridad } from '../seguridad/configurar.js';
import {
  CARPETA_POR_DEFECTO,
  carpetaDeLaInterfaz,
  configurarInterfaz,
} from './servir-interfaz.js';

const INDICE = '<!doctype html><html lang="es"><head><title>Faro de prueba</title></head><body><div id="raiz"></div></body></html>';
const SECRETO = 'contenido-secreto-fuera-de-la-interfaz';

/** Una ruta de la API que choca, a propósito, con las rutas de la interfaz del navegador. */
@Controller('documentos')
class DocumentosFalsos {
  @Get(':id')
  uno() {
    return { origen: 'api' };
  }
}

let raiz: string;
let carpeta: string;
const aplicaciones: INestApplication[] = [];

beforeAll(() => {
  raiz = mkdtempSync(join(tmpdir(), 'faro-interfaz-'));
  carpeta = join(raiz, 'web');
  mkdirSync(join(carpeta, 'assets'), { recursive: true });
  writeFileSync(join(carpeta, 'index.html'), INDICE);
  writeFileSync(join(carpeta, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  writeFileSync(join(carpeta, 'assets', 'index-AbC123.js'), 'console.log("faro");');
  writeFileSync(join(carpeta, '.oculto'), 'no se sirve');
  // Vive junto a la carpeta de la interfaz, no dentro: si un recorrido de rutas funcionara, saldría por aquí.
  writeFileSync(join(raiz, 'secreto.txt'), SECRETO);
});

afterAll(() => {
  rmSync(raiz, { recursive: true, force: true });
});

afterEach(async () => {
  for (const app of aplicaciones.splice(0)) await app.close();
});

/** Una aplicación sin base de datos: solo la ruta falsa de la API, la seguridad de producción y la interfaz. */
async function crearApp(ruta: string | undefined): Promise<{ app: INestApplication; servida: string | undefined }> {
  const modulo = await Test.createTestingModule({ controllers: [DocumentosFalsos] }).compile();
  const app = modulo.createNestApplication();
  configurarSeguridad(app, { CONFIAR_EN_PROXY: 0 });
  const servida = configurarInterfaz(app, { INTERFAZ_RUTA: ruta });
  await app.init();
  aplicaciones.push(app);
  return { app, servida };
}

const servidor = (app: INestApplication) => request(app.getHttpServer());

describe('interfaz web servida por la API', () => {
  describe('con una carpeta compilada', () => {
    it('sirve index.html en /app/ con caché corta (no-cache) y las cabeceras de seguridad', async () => {
      const { app, servida } = await crearApp(carpeta);
      expect(servida).toBe(carpeta);
      const respuesta = await servidor(app).get('/app/');
      expect(respuesta.status).toBe(200);
      expect(respuesta.headers['content-type']).toMatch(/text\/html/);
      expect(respuesta.headers['cache-control']).toBe('no-cache');
      expect(respuesta.text).toBe(INDICE);
      // Es la misma política de helmet de ADR-009: la interfaz no la relaja.
      expect(respuesta.headers['content-security-policy']).toContain("script-src 'self'");
      expect(respuesta.headers['x-content-type-options']).toBe('nosniff');
    });

    it('las rutas del cliente (sin extensión) devuelven index.html con 200: la interfaz decide qué pantalla', async () => {
      const { app } = await crearApp(carpeta);
      for (const ruta of ['/app/documentos', '/app/documentos/12', '/app/ingreso', '/app/documentos/12/version']) {
        const respuesta = await servidor(app).get(ruta);
        expect(respuesta.status, ruta).toBe(200);
        expect(respuesta.text, ruta).toBe(INDICE);
        expect(respuesta.headers['cache-control'], ruta).toBe('no-cache');
      }
    });

    it('/app/index.html pedido de frente tiene la misma caché corta', async () => {
      const { app } = await crearApp(carpeta);
      const respuesta = await servidor(app).get('/app/index.html');
      expect(respuesta.status).toBe(200);
      expect(respuesta.headers['cache-control']).toBe('no-cache');
    });

    it('/app/assets/* lleva caché de un año e immutable, con su tipo de contenido', async () => {
      const { app } = await crearApp(carpeta);
      const respuesta = await servidor(app).get('/app/assets/index-AbC123.js');
      expect(respuesta.status).toBe(200);
      expect(respuesta.headers['cache-control']).toBe('public, max-age=31536000, immutable');
      expect(respuesta.headers['content-type']).toMatch(/javascript/);
      expect(respuesta.text).toBe('console.log("faro");');
    });

    it('otros archivos (favicon) llevan caché de una hora', async () => {
      const { app } = await crearApp(carpeta);
      const respuesta = await servidor(app).get('/app/favicon.svg');
      expect(respuesta.status).toBe(200);
      expect(respuesta.headers['cache-control']).toBe('public, max-age=3600');
    });

    it('un archivo que no existe es 404 (JSON de la API), no index.html con 200: así no se oculta el error', async () => {
      const { app } = await crearApp(carpeta);
      for (const ruta of ['/app/assets/no-existe.js', '/app/no-existe.png', '/app/assets/falta.css']) {
        const respuesta = await servidor(app).get(ruta);
        expect(respuesta.status, ruta).toBe(404);
        expect(respuesta.headers['content-type'], ruta).toMatch(/json/);
        expect(respuesta.text, ruta).not.toContain('Faro de prueba');
      }
    });

    it('no sirve archivos ocultos', async () => {
      const { app } = await crearApp(carpeta);
      const respuesta = await servidor(app).get('/app/.oculto');
      expect(respuesta.status).toBe(404);
      expect(respuesta.text).not.toContain('no se sirve');
    });

    it('no deja salir de la carpeta (recorrido de rutas)', async () => {
      const { app } = await crearApp(carpeta);
      const intentos = [
        '/app/..%2fsecreto.txt',
        '/app/%2e%2e/secreto.txt',
        '/app/%2e%2e%2fsecreto.txt',
        '/app/assets/..%2f..%2fsecreto.txt',
        '/app/assets/%2e%2e%2f%2e%2e%2fsecreto.txt',
        '/app/..%5csecreto.txt',
        '/app/%00.txt',
        '/app/%E0%A4%A.txt',
      ];
      for (const ruta of intentos) {
        const respuesta = await servidor(app).get(ruta);
        expect(respuesta.text, ruta).not.toContain(SECRETO);
        expect(respuesta.status, ruta).not.toBe(200);
      }
    });

    it('/app sin la barra final redirige a /app/ y conserva la consulta', async () => {
      const { app } = await crearApp(carpeta);
      const respuesta = await servidor(app).get('/app?x=1').redirects(0);
      expect(respuesta.status).toBe(302);
      expect(respuesta.headers.location).toBe('/app/?x=1');
    });

    it('GET / redirige a /app/ (antes era un 404 que nadie usaba)', async () => {
      const { app } = await crearApp(carpeta);
      const respuesta = await servidor(app).get('/').redirects(0);
      expect(respuesta.status).toBe(302);
      expect(respuesta.headers.location).toBe('/app/');
    });

    it('HEAD /app/ responde 200 sin cuerpo', async () => {
      const { app } = await crearApp(carpeta);
      const respuesta = await servidor(app).head('/app/');
      expect(respuesta.status).toBe(200);
      expect(respuesta.text).toBeFalsy();
    });

    it('solo atiende GET y HEAD: un POST a /app/ sigue su camino y es 404', async () => {
      const { app } = await crearApp(carpeta);
      const respuesta = await servidor(app).post('/app/');
      expect(respuesta.status).toBe(404);
      expect(respuesta.text).not.toContain('Faro de prueba');
    });

    it('no estorba a la API: /documentos/12 sigue siendo la API aunque /app/documentos/12 sea la interfaz', async () => {
      const { app } = await crearApp(carpeta);
      const api = await servidor(app).get('/documentos/12');
      expect(api.status).toBe(200);
      expect(api.body).toEqual({ origen: 'api' });
      const interfaz = await servidor(app).get('/app/documentos/12');
      expect(interfaz.text).toBe(INDICE);
    });

    it('una ruta desconocida fuera de /app/ sigue siendo el 404 de siempre', async () => {
      const { app } = await crearApp(carpeta);
      const respuesta = await servidor(app).get('/no-existe');
      expect(respuesta.status).toBe(404);
      expect(respuesta.body).toMatchObject({ statusCode: 404 });
    });

    it('no agrega rutas al enrutador de Express: la prueba de la matriz de roles no la ve', async () => {
      const { app } = await crearApp(carpeta);
      const express = app.getHttpAdapter().getInstance() as {
        router?: { stack: Array<{ route?: { path: unknown } }> };
        _router?: { stack: Array<{ route?: { path: unknown } }> };
      };
      const pila = (express.router ?? express._router)?.stack ?? [];
      const rutas = pila.filter((capa) => capa.route).map((capa) => String(capa.route?.path));
      // Solo la ruta falsa de esta prueba; nada de /, /app ni /app/*.
      expect(rutas).toEqual(['/documentos/:id']);
    });
  });

  describe('sin interfaz compilada', () => {
    it('la API arranca igual y /app/ y / siguen respondiendo 404 (no hay a dónde redirigir)', async () => {
      const { app, servida } = await crearApp(join(raiz, 'no-existe'));
      expect(servida).toBeUndefined();
      expect((await servidor(app).get('/app/')).status).toBe(404);
      const raizDeLaApi = await servidor(app).get('/').redirects(0);
      expect(raizDeLaApi.status).toBe(404);
      expect((await servidor(app).get('/documentos/1')).body).toEqual({ origen: 'api' });
    });

    it('una carpeta sin index.html no cuenta como interfaz', async () => {
      const vacia = join(raiz, 'vacia');
      mkdirSync(vacia);
      const { servida } = await crearApp(vacia);
      expect(servida).toBeUndefined();
    });
  });
});

describe('carpetaDeLaInterfaz', () => {
  it('usa INTERFAZ_RUTA si tiene index.html', () => {
    expect(carpetaDeLaInterfaz({ INTERFAZ_RUTA: carpeta })).toBe(carpeta);
  });

  it('sin INTERFAZ_RUTA busca en apps/web/dist, contado desde el código (también dentro de la imagen)', () => {
    expect(CARPETA_POR_DEFECTO.split(sep).slice(-3)).toEqual(['apps', 'web', 'dist']);
  });

  it('si no hay nada que servir, devuelve undefined', () => {
    expect(carpetaDeLaInterfaz({ INTERFAZ_RUTA: join(raiz, 'otra-que-no-existe') })).toBeUndefined();
  });
});
