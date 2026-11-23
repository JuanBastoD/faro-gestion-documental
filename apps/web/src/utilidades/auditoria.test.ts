import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACCIONES_FILTRABLES, ETIQUETA_DE_ACCION, etiquetaDeAccion, finDelDia, inicioDelDia } from './auditoria';

/** Los valores del catálogo de acciones de la API (`ACCION` en `apps/api/src/auditoria/acciones.ts`), leídos del fuente. */
function accionesDeLaApi(): string[] {
  const fuente = readFileSync(join(import.meta.dirname, '../../../api/src/auditoria/acciones.ts'), 'utf8');
  const bloque = /export const ACCION = \{([\s\S]*?)\} as const;/.exec(fuente)?.[1] ?? '';
  return [...bloque.matchAll(/:\s*'([a-z_]+)'/g)].map((m) => m[1]);
}

describe('catálogo de acciones', () => {
  it('el catálogo de la API se pudo leer (si esta prueba falla, cambió el formato de acciones.ts)', () => {
    const acciones = accionesDeLaApi();
    expect(acciones.length).toBeGreaterThanOrEqual(14);
    expect(acciones).toContain('usuario_creado');
  });

  it('cada acción que se ofrece en el filtro existe en la API: de otro modo, elegirla daría un 400', () => {
    const enLaApi = accionesDeLaApi();
    for (const accion of ACCIONES_FILTRABLES) expect(enLaApi, accion).toContain(accion);
  });

  it('cada acción de la API tiene su texto en español (si la API agrega una, hay que ponerle texto aquí)', () => {
    for (const accion of accionesDeLaApi()) expect(ETIQUETA_DE_ACCION[accion], accion).toBeDefined();
  });

  it('cada acción que se ofrece tiene texto, y sin repetirse', () => {
    for (const accion of ACCIONES_FILTRABLES) expect(ETIQUETA_DE_ACCION[accion], accion).toBeDefined();
    expect(new Set(ACCIONES_FILTRABLES).size).toBe(ACCIONES_FILTRABLES.length);
    expect(new Set(Object.values(ETIQUETA_DE_ACCION)).size).toBe(Object.values(ETIQUETA_DE_ACCION).length);
  });

  it('una acción desconocida se muestra con su código', () => {
    expect(etiquetaDeAccion('usuario_creado')).toBe('Usuario creado');
    expect(etiquetaDeAccion('accion_nueva')).toBe('accion_nueva');
  });
});

describe('límites del día en la hora de Colombia', () => {
  it('el día empieza a las 00:00 de Colombia (05:00 UTC)', () => {
    expect(inicioDelDia('2026-11-22')).toBe('2026-11-22T05:00:00.000Z');
  });

  it('el día termina a las 23:59:59,999 de Colombia, que ya es el día siguiente en UTC', () => {
    expect(finDelDia('2026-11-22')).toBe('2026-11-23T04:59:59.999Z');
  });

  it('en el cambio de año y en un año bisiesto', () => {
    expect(finDelDia('2026-12-31')).toBe('2027-01-01T04:59:59.999Z');
    expect(inicioDelDia('2028-02-29')).toBe('2028-02-29T05:00:00.000Z');
  });

  it('un evento a las 23:30 de Colombia del día elegido queda dentro del rango, y uno a las 00:10 del siguiente, fuera', () => {
    const dentro = Date.parse('2026-11-23T04:30:00.000Z'); // 23:30 del 22 en Colombia
    const fuera = Date.parse('2026-11-23T05:10:00.000Z'); // 00:10 del 23 en Colombia
    expect(dentro).toBeGreaterThanOrEqual(Date.parse(inicioDelDia('2026-11-22')));
    expect(dentro).toBeLessThanOrEqual(Date.parse(finDelDia('2026-11-22')));
    expect(fuera).toBeGreaterThan(Date.parse(finDelDia('2026-11-22')));
  });
});
