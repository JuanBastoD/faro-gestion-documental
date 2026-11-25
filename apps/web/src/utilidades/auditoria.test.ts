import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ACCIONES_FILTRABLES,
  ETIQUETA_DE_ACCION,
  TEXTO_DE_ACCESO_DENEGADO,
  detalleVisible,
  etiquetaDeAccion,
  finDelDia,
  inicioDelDia,
} from './auditoria';

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

describe('detalle de un evento tal como lo ve la persona', () => {
  it('el detalle técnico de un acceso denegado se dice con palabras, sin ruta, método ni rol interno', () => {
    const detalles = [
      'GET /auditoria; requiere administrador; tiene consulta',
      'GET /usuarios; requiere administrador; tiene editor',
      'POST /documentos; requiere administrador o editor; tiene consulta',
      'PATCH /usuarios/2; requiere administrador; tiene editor',
    ];
    for (const detalle of detalles) {
      const texto = detalleVisible('acceso_denegado', detalle);
      expect(texto, detalle).toBe(TEXTO_DE_ACCESO_DENEGADO);
      expect(texto).not.toMatch(/\/|GET|POST|PATCH|requiere|tiene|administrador|editor|consulta/);
    }
  });

  it('un detalle de acceso denegado con otro formato, o sin detalle, no se toca: no se oculta lo que no se reconoce', () => {
    expect(detalleVisible('acceso_denegado', 'otro texto de la API')).toBe('otro texto de la API');
    expect(detalleVisible('acceso_denegado', 'GET /auditoria; requiere administrador')).toBe('GET /auditoria; requiere administrador');
    expect(detalleVisible('acceso_denegado', null)).toBeNull();
  });

  it('el detalle de cualquier otra acción se muestra tal cual, aunque se parezca', () => {
    expect(detalleVisible('carga', 'GET /auditoria; requiere administrador; tiene consulta')).toBe(
      'GET /auditoria; requiere administrador; tiene consulta',
    );
    expect(detalleVisible('usuario_rol_cambiado', 'usuario 3 (consulta.demo); rol consulta → editor')).toBe(
      'usuario 3 (consulta.demo); rol consulta → editor',
    );
    expect(detalleVisible('ingreso_fallido', null)).toBeNull();
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
