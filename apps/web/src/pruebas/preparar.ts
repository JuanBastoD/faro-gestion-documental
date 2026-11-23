import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { crearDireccionFalsa, liberarDireccionFalsa } from './blobs';

// jsdom no implementa `URL.createObjectURL`: se sustituye por los espías de `blobs.ts`, que arrancan limpios en cada prueba.
beforeEach(() => {
  crearDireccionFalsa.mockClear();
  liberarDireccionFalsa.mockClear();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: crearDireccionFalsa });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: liberarDireccionFalsa });
});

// Cada prueba parte limpia: sin árbol montado, sin espías ni sustituciones de `fetch`.
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
