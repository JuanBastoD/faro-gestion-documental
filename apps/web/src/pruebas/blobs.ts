import { vi } from 'vitest';

/**
 * jsdom no implementa `URL.createObjectURL` (la pantalla de duplicado lo usa para abrir el PDF nuevo en otra pestaña):
 * `preparar.ts` lo sustituye por estos espías, que devuelven una dirección `blob:` de mentira. Las pruebas importan los
 * espías de aquí para mirar sus llamadas.
 */
export const crearDireccionFalsa = vi.fn((_objeto: Blob | MediaSource) => 'blob:prueba/archivo-nuevo');
export const liberarDireccionFalsa = vi.fn((_direccion: string) => undefined);
