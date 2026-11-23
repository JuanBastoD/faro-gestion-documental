import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Con `css: false` (vite.config.ts) Vitest reemplaza por texto vacío los CSS importados, también con `?raw`: se lee del disco.
const estilos = readFileSync(join(import.meta.dirname, 'estilos.css'), 'utf8');

/** El cuerpo de la primera regla cuyo selector es exactamente `selector` (sin media queries ni selectores compuestos). */
function cuerpoDeRegla(selector: string): string {
  const escapado = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regla = new RegExp(`(?:^|\\})\\s*${escapado}\\s*\\{([^}]*)\\}`, 'm').exec(estilos);
  return regla?.[1] ?? '';
}

/**
 * jsdom no aplica el CSS, así que un defecto de maquetación no lo ve ninguna prueba de pantalla. Esta comprueba la regla que
 * evita uno ya ocurrido: el aviso «Tu sesión terminó» es un `<output>` (en línea por omisión) y, con relleno y borde, se
 * partía por renglones y se salía de la tarjeta de ingreso. Se ve en un navegador real a 360 y 1280 px (PR de #25).
 */
describe('estilos.css', () => {
  it('los avisos son bloques: los que son <output> no se parten por renglones dentro de su tarjeta', () => {
    expect(cuerpoDeRegla('.aviso')).toMatch(/display:\s*block/);
  });
});
