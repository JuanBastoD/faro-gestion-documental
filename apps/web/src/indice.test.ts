import { describe, expect, it } from 'vitest';
import indice from '../index.html?raw';

/**
 * La API sirve la interfaz con la política de contenido de helmet (ADR-009 y ADR-012): `script-src 'self'` y
 * `script-src-attr 'none'`, sin orígenes externos. Estas comprobaciones sobre `index.html` evitan que alguien agregue
 * un script en línea, un manejador `onclick=`, una fuente o una hoja de estilos externa y deje la interfaz en blanco
 * solo en producción. La comprobación con un navegador real está en el PR; esto la protege en cada ejecución del CI.
 */
describe('index.html es compatible con la política de contenido de la API', () => {
  it('declara el idioma español', () => {
    expect(indice).toMatch(/<html[^>]*\slang="es"/);
  });

  it('todos los scripts son archivos propios, sin código en línea', () => {
    const scripts = [...indice.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    expect(scripts.length).toBeGreaterThan(0);
    for (const [, atributos, cuerpo] of scripts) {
      expect(atributos).toMatch(/\ssrc="\/src\//);
      expect(cuerpo.trim()).toBe('');
    }
  });

  it('no usa manejadores de eventos ni estilos en línea', () => {
    expect(indice).not.toMatch(/\son[a-z]+\s*=/i);
    expect(indice).not.toMatch(/\sstyle\s*=/i);
    expect(indice).not.toMatch(/<style\b/i);
  });

  it('no carga nada de otros orígenes (fuentes, hojas de estilo, scripts)', () => {
    const referencias = [...indice.matchAll(/\s(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
    for (const referencia of referencias) expect(referencia, referencia).not.toMatch(/^(?:https?:)?\/\//);
  });
});
