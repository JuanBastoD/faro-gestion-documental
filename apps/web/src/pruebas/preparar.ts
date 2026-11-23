import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

// jsdom no implementa `URL.createObjectURL` (la pantalla de duplicado lo usa para abrir el PDF nuevo): se sustituye por
// funciones espía que devuelven una dirección `blob:` de mentira. Las pruebas pueden mirar sus llamadas con `vi.mocked`.
beforeEach(() => {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: vi.fn(() => 'blob:prueba/archivo-nuevo'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: vi.fn() });
});

// Cada prueba parte limpia: sin árbol montado, sin espías ni sustituciones de `fetch`.
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
