import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALFABETO_DE_CLAVE, generarClaveTemporal, LONGITUD_DE_CLAVE_GENERADA, type FuenteDeBytes } from './clave';

afterEach(() => vi.restoreAllMocks());

const FORMA = /^[A-HJ-NP-Za-km-z2-9]{4}(-[A-HJ-NP-Za-km-z2-9]{4}){3}$/;

/** Una fuente que entrega los bytes dados, por tandas, y repite la última si se acaban. */
function fuenteDe(...tandas: number[][]): FuenteDeBytes {
  let i = 0;
  return (cantidad) => {
    const tanda = tandas[Math.min(i, tandas.length - 1)];
    i += 1;
    return Uint8Array.from(Array.from({ length: cantidad }, (_, k) => tanda[k % tanda.length]));
  };
}

describe('generarClaveTemporal', () => {
  it('son 16 símbolos en cuatro grupos de cuatro separados por guion, sin los que se confunden (0, O, 1, l, I)', () => {
    const clave = generarClaveTemporal();
    expect(clave).toMatch(FORMA);
    expect(clave).toHaveLength(19);
    expect(clave.replaceAll('-', '')).toHaveLength(LONGITUD_DE_CLAVE_GENERADA);
    expect(ALFABETO_DE_CLAVE).not.toMatch(/[0OlI1]/);
    // 26 + 26 + 10 = 62 letras y números, menos los cinco que se confunden.
    expect(ALFABETO_DE_CLAVE).toHaveLength(57);
    expect(new Set(ALFABETO_DE_CLAVE).size).toBe(57);
    expect(ALFABETO_DE_CLAVE).toMatch(/^[A-Za-z2-9]+$/);
  });

  it('cumple lo que pide la API para una clave (12 a 256 caracteres, no solo espacios)', () => {
    const clave = generarClaveTemporal();
    expect(clave.length).toBeGreaterThanOrEqual(12);
    expect(clave.length).toBeLessThanOrEqual(256);
    expect(clave.trim()).not.toBe('');
  });

  it('usa crypto.getRandomValues y nunca Math.random', () => {
    const azar = vi.spyOn(Math, 'random');
    const cripto = vi.spyOn(crypto, 'getRandomValues');
    generarClaveTemporal();
    expect(cripto).toHaveBeenCalled();
    expect(azar).not.toHaveBeenCalled();
  });

  it('con la misma fuente de bytes da siempre lo mismo, símbolo a símbolo según el alfabeto', () => {
    const bytes = Array.from({ length: 16 }, (_, i) => i * 3);
    const clave = generarClaveTemporal(fuenteDe(bytes));
    const esperada = bytes.map((b) => ALFABETO_DE_CLAVE[b]).join('');
    expect(clave.replaceAll('-', '')).toBe(esperada);
    expect(clave).toBe(`${esperada.slice(0, 4)}-${esperada.slice(4, 8)}-${esperada.slice(8, 12)}-${esperada.slice(12, 16)}`);
  });

  it('descarta los bytes de 228 en adelante (no caben en un múltiplo exacto del alfabeto) para que ningún símbolo sea más probable', () => {
    // Primera tanda: solo 228 a 255, que debe descartarse entera. Segunda: el 227 es el último que vale y da el último símbolo.
    const rechazados = Array.from({ length: 28 }, (_, i) => 228 + i);
    const clave = generarClaveTemporal(fuenteDe(rechazados, [227]));
    expect(clave.replaceAll('-', '')).toBe(ALFABETO_DE_CLAVE.at(-1)?.repeat(16));
    // El 228 sería el primer símbolo si no se descartara.
    expect(generarClaveTemporal(fuenteDe([228], [0])).replaceAll('-', '')).toBe(ALFABETO_DE_CLAVE[0].repeat(16));
  });

  it('cada símbolo del alfabeto sale con la misma frecuencia cuando los bytes recorren todos los valores aceptados', () => {
    // Los 228 valores que se aceptan (0 a 227) dan 4 vueltas completas al alfabeto de 57. Cuatro veces esa secuencia son 912
    // bytes: 57 claves de 16 símbolos, en las que cada símbolo aparece exactamente 16 veces.
    const aceptados = Array.from({ length: 228 }, (_, i) => i);
    const todos = [...aceptados, ...aceptados, ...aceptados, ...aceptados];
    const cuenta = new Map<string, number>();
    for (let i = 0; i < 57; i += 1) {
      const tanda = todos.slice(i * 16, i * 16 + 16);
      for (const simbolo of generarClaveTemporal(fuenteDe(tanda)).replaceAll('-', '')) cuenta.set(simbolo, (cuenta.get(simbolo) ?? 0) + 1);
    }
    expect(cuenta.size).toBe(57);
    expect(new Set(cuenta.values())).toEqual(new Set([16]));
  });

  it('dos claves seguidas no se repiten', () => {
    const claves = new Set(Array.from({ length: 50 }, () => generarClaveTemporal()));
    expect(claves.size).toBe(50);
  });
});
