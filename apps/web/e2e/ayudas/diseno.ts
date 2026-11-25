import { expect, type Page } from '@playwright/test';

/**
 * Comprobaciones de DISEÑO que ni jsdom ni axe pueden hacer: miden cajas reales en un navegador real. Nacieron de un
 * defecto que ya costó una corrección (PR #58, `cac8cfe`): en «Elige con cuál quieres comparar» las opciones se
 * montaban unas sobre otras y la página no tenía errores, ni de consola ni de accesibilidad.
 */

interface MedidaDeOpcion {
  indice: number;
  arriba: number;
  abajo: number;
  izquierda: number;
  derecha: number;
  alto: number;
  /** `scrollHeight` y `clientHeight` del recuadro: si el texto no cabe, el primero supera al segundo. */
  alturaDelContenido: number;
  alturaVisible: number;
  textoDentro: boolean;
  radioDentro: boolean;
}

interface MedidasDeLaLista {
  opciones: MedidaDeOpcion[];
  /** Pares de opciones (1-indexados) cuyas cajas se intersectan. */
  cruces: string[];
  grupoContieneLasOpciones: boolean;
  anchoDelDocumento: number;
  anchoDeLaVentana: number;
}

/** Mide cada opción de la lista «Elige con cuál quieres comparar» (su recuadro, su texto y su botón de opción). */
async function medirListaDeCandidatos(page: Page): Promise<MedidasDeLaLista> {
  return page.evaluate(() => {
    const grupo = [...document.querySelectorAll('fieldset')].find((f) => f.querySelector('legend')?.textContent?.includes('Elige con cuál'));
    if (!grupo) throw new Error('No hay una lista «Elige con cuál quieres comparar» en la pantalla');
    const redondear = (n: number) => Math.round(n * 10) / 10;

    const opciones = [...grupo.querySelectorAll('input[type=radio]')].map((radio, i) => {
      // La «opción» es el recuadro que rodea a cada botón de opción: el ancestro más cercano con borde propio dentro del grupo.
      let caja: Element | null = radio.parentElement;
      while (caja && caja !== grupo && getComputedStyle(caja).borderTopWidth === '0px') caja = caja.parentElement;
      if (!caja || caja === grupo) throw new Error(`La opción ${i + 1} no tiene un recuadro propio dentro de la lista`);

      const r = caja.getBoundingClientRect();
      const rango = document.createRange();
      rango.selectNodeContents(caja);
      const t = rango.getBoundingClientRect();
      const rr = radio.getBoundingClientRect();
      return {
        indice: i + 1,
        arriba: redondear(r.top),
        abajo: redondear(r.bottom),
        izquierda: redondear(r.left),
        derecha: redondear(r.right),
        alto: redondear(r.height),
        alturaDelContenido: caja.scrollHeight,
        alturaVisible: caja.clientHeight,
        textoDentro: t.top >= r.top - 0.5 && t.bottom <= r.bottom + 0.5 && t.left >= r.left - 0.5 && t.right <= r.right + 0.5,
        radioDentro: rr.top >= r.top - 0.5 && rr.bottom <= r.bottom + 0.5 && rr.left >= r.left - 0.5 && rr.right <= r.right + 0.5,
      };
    });

    const cruces: string[] = [];
    for (let a = 0; a < opciones.length; a++) {
      for (let b = a + 1; b < opciones.length; b++) {
        const p = opciones[a];
        const q = opciones[b];
        const separadas = p.derecha <= q.izquierda + 0.5 || q.derecha <= p.izquierda + 0.5 || p.abajo <= q.arriba + 0.5 || q.abajo <= p.arriba + 0.5;
        if (!separadas) cruces.push(`${p.indice}-${q.indice}`);
      }
    }

    const g = grupo.getBoundingClientRect();
    const ultima = opciones[opciones.length - 1];
    return {
      opciones,
      cruces,
      grupoContieneLasOpciones: g.top <= opciones[0].arriba + 0.5 && g.bottom >= ultima.abajo - 0.5,
      anchoDelDocumento: document.documentElement.scrollWidth,
      anchoDeLaVentana: window.innerWidth,
    };
  });
}

/** Cambia el ancho de la ventana y espera a que el navegador haya vuelto a distribuir la página (sin esperas fijas). */
export async function cambiarAncho(page: Page, ancho: number, alto = 800): Promise<void> {
  await page.setViewportSize({ width: ancho, height: alto });
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(ancho);
  // Dos fotogramas: el primero aplica los estilos nuevos y el segundo asegura que la distribución ya se calculó.
  await page.evaluate(() => new Promise<void>((resolver) => requestAnimationFrame(() => requestAnimationFrame(() => resolver()))));
}

/**
 * La lista de candidatos con `cuantos` opciones, al ancho actual: ningún par de opciones se intersecta (`getBoundingClientRect`),
 * el texto de cada una cabe en su recuadro (`scrollHeight <= clientHeight`), una opción por línea y la página no se desborda.
 */
export async function afirmarListaDeCandidatos(page: Page, cuantos: number, descripcion: string): Promise<void> {
  const m = await medirListaDeCandidatos(page);
  const medidas = m.opciones.map((o) => `#${o.indice} ${o.arriba}→${o.abajo} (x ${o.izquierda}→${o.derecha}, scrollH ${o.alturaDelContenido}/clientH ${o.alturaVisible})`).join('; ');
  const contexto = `${descripcion}: ${medidas}`;

  expect(m.opciones, `${descripcion}: cantidad de opciones`).toHaveLength(cuantos);
  expect(m.cruces, `${descripcion}: pares de opciones que se intersectan. ${contexto}`).toEqual([]);
  expect(
    m.opciones.filter((o) => o.alturaDelContenido > o.alturaVisible || !o.textoDentro).map((o) => o.indice),
    `${descripcion}: opciones cuyo texto no cabe en su recuadro. ${contexto}`,
  ).toEqual([]);
  expect(
    m.opciones.filter((o, i) => i > 0 && o.arriba < m.opciones[i - 1].abajo - 0.5).map((o) => o.indice),
    `${descripcion}: opciones que no empiezan después de la anterior. ${contexto}`,
  ).toEqual([]);
  expect(m.opciones.every((o) => o.radioDentro) && m.grupoContieneLasOpciones, `${descripcion}: el botón y el grupo contienen a las opciones. ${contexto}`).toBe(true);
  expect(m.anchoDelDocumento, `${descripcion}: la página no debe desbordarse a lo ancho`).toBeLessThanOrEqual(m.anchoDeLaVentana);
}
