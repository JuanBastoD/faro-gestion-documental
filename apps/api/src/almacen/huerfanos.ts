import type { ObjetoAlmacenado } from './almacen-archivos.js';

/**
 * Objetos del almacén que ninguna versión usa y que son lo bastante viejos para no ser una carga
 * en curso. Una carga guarda el objeto un instante antes de insertar su fila, así que se exige
 * una antigüedad mínima para no tocar lo que se está subiendo en este momento.
 */
export function calcularHuerfanos(
  objetos: ObjetoAlmacenado[],
  referenciadas: ReadonlySet<string>,
  ahora: Date,
  antiguedadMinimaMs: number,
): ObjetoAlmacenado[] {
  return objetos.filter(
    (objeto) =>
      !referenciadas.has(objeto.clave) &&
      ahora.getTime() - objeto.modificadoEn.getTime() >= antiguedadMinimaMs,
  );
}
