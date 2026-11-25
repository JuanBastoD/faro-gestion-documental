import type { NextFunction, Request, Response } from 'express';
import { esRutaDeLaInterfaz, sinCacheEnLaApi } from './sin-cache.js';

function ejecutar(ruta: string): { cabeceras: Record<string, string>; siguientes: number } {
  const cabeceras: Record<string, string> = {};
  let siguientes = 0;
  const respuesta = { setHeader: (nombre: string, valor: string) => void (cabeceras[nombre] = valor) } as unknown as Response;
  const siguiente: NextFunction = () => void siguientes++;
  sinCacheEnLaApi({ path: ruta } as Request, respuesta, siguiente);
  return { cabeceras, siguientes };
}

describe('esRutaDeLaInterfaz', () => {
  it.each(['/app', '/app/', '/app/assets/index-abc123.js', '/app/documentos/12'])('%s es la interfaz', (ruta) => {
    expect(esRutaDeLaInterfaz(ruta)).toBe(true);
  });

  it.each(['/', '/documentos', '/auth/yo', '/health', '/apps', '/appx/prueba', '/aplicacion', '/application/app/', '/App/x', '/documentos/app/1'])(
    '%s no es la interfaz',
    (ruta) => {
      expect(esRutaDeLaInterfaz(ruta)).toBe(false);
    },
  );
});

describe('sinCacheEnLaApi', () => {
  it.each(['/documentos', '/documentos/1/versiones/1/archivo', '/auth/yo', '/health', '/ruta-que-no-existe', '/', '/apps'])(
    'pone Cache-Control: no-store en %s y deja pasar la petición',
    (ruta) => {
      const { cabeceras, siguientes } = ejecutar(ruta);
      expect(cabeceras).toEqual({ 'Cache-Control': 'no-store' });
      expect(siguientes).toBe(1);
    },
  );

  it.each(['/app', '/app/', '/app/assets/index-abc123.js'])('no toca la cabecera de %s y deja pasar la petición', (ruta) => {
    const { cabeceras, siguientes } = ejecutar(ruta);
    expect(cabeceras).toEqual({});
    expect(siguientes).toBe(1);
  });
});
