import type { FilaCuadro } from './cuadro.js';
import type { ErrorLinea } from './csv.js';
import type { Ausente, Plan } from './plan.js';

/**
 * Texto que muestra el comando de importación (#19). Funciones puras para poder probar lo que lee la persona:
 * en una importación que toca el cuadro de una entidad, el mensaje es parte del producto.
 */

const plural = (n: number, singular: string, pluralDe: string): string => `${n} ${n === 1 ? singular : pluralDe}`;

export function formatearErrores(titulo: string, errores: ErrorLinea[]): string {
  const lineas = errores.map((e) => (e.linea === null ? `  - ${e.mensaje}` : `  - línea ${e.linea}: ${e.mensaje}`));
  return [titulo, ...lineas].join('\n');
}

function cuantosDocumentos(a: Ausente): string {
  return a.documentos > 0 ? plural(a.documentos, 'documento', 'documentos') : 'sin documentos';
}

/**
 * El plan, listo para imprimir. `aplicado` distingue «se hizo» de «se haría»; `eliminarAusentes` dice si
 * se pidió borrar lo que el archivo no menciona (para explicar por qué sigue ahí).
 */
export function formatearPlan(
  plan: Plan,
  contexto: { filas: FilaCuadro[]; aplicado: boolean; eliminarAusentes: boolean },
): string {
  const verbo = contexto.aplicado
    ? { crear: 'Creadas', renombrar: 'Renombradas', mover: 'Movidas', eliminar: 'Eliminadas' }
    : { crear: 'Se crearían', renombrar: 'Se renombrarían', mover: 'Se moverían', eliminar: 'Se eliminarían' };
  const series = contexto.filas.filter((f) => f.codigoPadre === null).length;
  const salida: string[] = [
    `Archivo: ${contexto.filas.length} filas válidas (${plural(series, 'serie', 'series')} y ${plural(contexto.filas.length - series, 'subserie', 'subseries')}).`,
  ];

  const bloque = (titulo: string, lineas: string[]): void => {
    if (lineas.length === 0) return;
    salida.push('', `${titulo} (${lineas.length}):`, ...lineas.map((l) => `  ${l}`));
  };

  bloque(
    verbo.crear,
    plan.crear.map((f) =>
      f.codigoPadre === null ? `+ ${f.codigo}  ${f.nombre}  (serie)` : `+ ${f.codigo}  ${f.nombre}  (subserie de ${f.codigoPadre})`,
    ),
  );
  bloque(
    verbo.renombrar,
    plan.renombrar.map((r) => `~ ${r.codigo}  «${r.nombreActual}» -> «${r.nombreNuevo}»`),
  );
  bloque(
    verbo.mover,
    plan.mover.map((m) => `> ${m.codigo}  de la serie ${m.padreActual} a la ${m.padreNuevo}`),
  );
  bloque(
    verbo.eliminar,
    plan.eliminar.map((a) => `- ${a.codigo}  ${a.nombre}  (${a.nivel}, sin documentos)`),
  );
  bloque(
    'Ausentes del archivo que se conservan',
    plan.conservadas.map((a) => {
      const motivo =
        a.documentos > 0
          ? `${cuantosDocumentos(a)}: nunca se elimina`
          : contexto.eliminarAusentes
            ? 'sin documentos'
            : 'sin documentos; se eliminaría con --eliminar-ausentes';
      return `= ${a.codigo}  ${a.nombre}  (${a.nivel}, ${motivo})`;
    }),
  );

  salida.push('', `Sin cambios: ${plan.sinCambios}.`);
  return salida.join('\n');
}
