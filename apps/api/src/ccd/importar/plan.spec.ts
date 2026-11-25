import type { FilaCuadro } from './cuadro.js';
import { formatearErrores, formatearPlan } from './informe.js';
import { hayCambios, planificar, type SerieActual } from './plan.js';
import { detalleDeAuditoria } from './importar.js';

let linea = 1;
const fila = (codigo: string, nombre: string, codigoPadre: string | null = null): FilaCuadro => ({
  linea: ++linea,
  codigo,
  nombre,
  codigoPadre,
});
const actual = (id: number, codigo: string, nombre: string, padreCodigo: string | null = null, documentos = 0): SerieActual => ({
  id,
  codigo,
  nombre,
  padreCodigo,
  documentos,
});

const SIN_OPCIONES = { eliminarAusentes: false };
const CON_ELIMINAR = { eliminarAusentes: true };

/** Un cuadro de hoy: dos series, con documentos solo en 100.1. */
const hoy = [
  actual(1, '100', 'Gestión contractual'),
  actual(2, '100.1', 'Contratos de obra', '100', 3),
  actual(3, '100.2', 'Interventoría', '100'),
  actual(4, '200', 'Gestión jurídica'),
  actual(5, '200.1', 'Conceptos', '200'),
];
/** El mismo cuadro, escrito como archivo. */
const igual = () => [
  fila('100', 'Gestión contractual'),
  fila('100.1', 'Contratos de obra', '100'),
  fila('100.2', 'Interventoría', '100'),
  fila('200', 'Gestión jurídica'),
  fila('200.1', 'Conceptos', '200'),
];

describe('planificar', () => {
  it('con la base vacía crea todo, las series antes que las subseries', () => {
    const plan = planificar([fila('100.1', 'Obras', '100'), fila('100', 'Gestión'), fila('200', 'Jurídica')], [], SIN_OPCIONES);
    expect(plan.crear.map((f) => f.codigo)).toEqual(['100', '200', '100.1']);
    expect([plan.renombrar, plan.mover, plan.eliminar, plan.conservadas, plan.conflictos]).toEqual([[], [], [], [], []]);
    expect(hayCambios(plan)).toBe(true);
  });

  it('el mismo cuadro no cambia nada (idempotencia)', () => {
    const plan = planificar(igual(), hoy, CON_ELIMINAR);
    expect(hayCambios(plan)).toBe(false);
    expect(plan.sinCambios).toBe(5);
    expect(plan.conflictos).toEqual([]);
  });

  it('renombrar es seguro aunque la subserie tenga documentos', () => {
    const filas = igual();
    filas[1] = fila('100.1', 'Contratos de obra civil', '100');
    const plan = planificar(filas, hoy, SIN_OPCIONES);
    expect(plan.renombrar).toEqual([{ codigo: '100.1', nombreActual: 'Contratos de obra', nombreNuevo: 'Contratos de obra civil' }]);
    expect(plan.conflictos).toEqual([]);
    expect(plan.sinCambios).toBe(4);
  });

  describe('mover de serie', () => {
    it('una subserie sin documentos se puede mover, también a una serie que se crea en la misma importación', () => {
      const filas = igual().filter((f) => f.codigo !== '100.2');
      filas.push(fila('300', 'Nueva serie'), fila('100.2', 'Interventoría', '300'));
      const plan = planificar(filas, hoy, SIN_OPCIONES);
      expect(plan.mover).toEqual([{ codigo: '100.2', padreActual: '100', padreNuevo: '300' }]);
      expect(plan.crear.map((f) => f.codigo)).toEqual(['300']);
      expect(plan.conflictos).toEqual([]);
    });

    it('una subserie CON documentos no se mueve: es un conflicto con la línea del archivo y no queda en el plan', () => {
      const filas = igual().filter((f) => f.codigo !== '100.1');
      const movida = fila('100.1', 'Contratos de obra', '200');
      filas.push(movida);
      const plan = planificar(filas, hoy, SIN_OPCIONES);
      expect(plan.mover).toEqual([]);
      expect(plan.conflictos).toEqual([
        { linea: movida.linea, mensaje: expect.stringMatching(/100\.1 tiene 3 documentos .* de la serie 100 a la 200/) },
      ]);
    });

    it('el mensaje del conflicto usa el singular con un solo documento', () => {
      const una = hoy.map((s) => (s.codigo === '100.1' ? { ...s, documentos: 1 } : s));
      const filas = igual().filter((f) => f.codigo !== '100.1');
      filas.push(fila('100.1', 'Contratos de obra', '200'));
      expect(planificar(filas, una, SIN_OPCIONES).conflictos[0].mensaje).toContain('tiene 1 documento y');
    });
  });

  describe('cambiar de nivel', () => {
    it('una serie que el archivo declara subserie es un conflicto, tenga o no documentos', () => {
      const filas = igual().filter((f) => f.codigo !== '200');
      filas.push(fila('200', 'Gestión jurídica', '100'));
      const plan = planificar(filas, hoy, SIN_OPCIONES);
      expect(plan.conflictos).toHaveLength(1);
      expect(plan.conflictos[0].mensaje).toContain('200 es una serie en la base y el archivo la declara subserie');
    });

    it('una subserie que el archivo declara serie también, aunque no tenga documentos', () => {
      const filas = igual().filter((f) => f.codigo !== '100.2');
      filas.push(fila('100.2', 'Interventoría'));
      const plan = planificar(filas, hoy, SIN_OPCIONES);
      expect(plan.conflictos).toHaveLength(1);
      expect(plan.conflictos[0].mensaje).toContain('100.2 es una subserie en la base y el archivo la declara serie');
      expect(plan.mover).toEqual([]);
    });
  });

  describe('lo que la base tiene y el archivo no menciona', () => {
    // Del cuadro de hoy, el archivo solo trae la serie 100 y su subserie 100.1.
    const parcial = () => [fila('100', 'Gestión contractual'), fila('100.1', 'Contratos de obra', '100')];

    it('por defecto se conserva y se informa, con sus documentos', () => {
      const plan = planificar(parcial(), hoy, SIN_OPCIONES);
      expect(plan.eliminar).toEqual([]);
      expect(plan.conservadas.map((a) => [a.codigo, a.documentos])).toEqual([
        ['100.2', 0],
        ['200', 0],
        ['200.1', 0],
      ]);
      expect(hayCambios(plan)).toBe(false);
    });

    it('con eliminarAusentes se eliminan las subseries primero y las series después', () => {
      const plan = planificar(parcial(), hoy, CON_ELIMINAR);
      expect(plan.eliminar.map((a) => `${a.nivel} ${a.codigo}`)).toEqual(['subserie 100.2', 'subserie 200.1', 'serie 200']);
      expect(plan.conservadas).toEqual([]);
    });

    it('nunca se elimina una subserie con documentos', () => {
      // El archivo ya no menciona 100.1 (que tiene 3 documentos) ni su serie 100.
      const plan = planificar([fila('200', 'Gestión jurídica'), fila('200.1', 'Conceptos', '200')], hoy, CON_ELIMINAR);
      expect(plan.eliminar.map((a) => a.codigo)).toEqual(['100.2']);
      expect(plan.conservadas.map((a) => [a.codigo, a.documentos])).toEqual([
        ['100', 3],
        ['100.1', 3],
      ]);
    });

    it('una serie ausente con una subserie con documentos se conserva entera, y su subserie sin documentos sí se elimina', () => {
      const plan = planificar([fila('200', 'Gestión jurídica')], hoy, CON_ELIMINAR);
      expect(plan.eliminar.map((a) => a.codigo)).toEqual(['100.2', '200.1']);
      expect(plan.conservadas.map((a) => a.codigo)).toEqual(['100', '100.1']);
    });

    it('una serie ausente sigue contando los documentos de una subserie que el archivo intenta mover (y eso ya es un conflicto)', () => {
      const filas = [fila('200', 'Gestión jurídica'), fila('100.1', 'Contratos de obra', '200')];
      const plan = planificar(filas, hoy, CON_ELIMINAR);
      expect(plan.conflictos).toHaveLength(1);
      expect(plan.conservadas.map((a) => a.codigo)).toContain('100');
    });

    it('una serie ausente cuyas subseries pasan a otra serie (sin documentos) se puede eliminar', () => {
      const filas = [fila('200', 'Gestión jurídica'), fila('200.1', 'Conceptos', '200'), fila('100.2', 'Interventoría', '200')];
      const sinDocumentos = hoy.map((s) => ({ ...s, documentos: 0 }));
      const plan = planificar(filas, sinDocumentos, CON_ELIMINAR);
      expect(plan.mover).toEqual([{ codigo: '100.2', padreActual: '100', padreNuevo: '200' }]);
      expect(plan.eliminar.map((a) => a.codigo)).toEqual(['100.1', '100']);
    });
  });
});

describe('informe', () => {
  const plan = planificar(
    [fila('100', 'Gestión contractual'), fila('100.1', 'Contratos de obra civil', '100'), fila('300', 'Nueva')],
    hoy,
    SIN_OPCIONES,
  );
  const filas = [fila('100', 'Gestión contractual'), fila('100.1', 'Contratos de obra civil', '100'), fila('300', 'Nueva')];

  it('en simulación habla en condicional y dice cómo aplicar lo conservado', () => {
    const texto = formatearPlan(plan, { filas, aplicado: false, eliminarAusentes: false });
    expect(texto).toContain('Archivo: 3 filas válidas (2 series y 1 subserie).');
    expect(texto).toContain('Se crearían (1):\n  + 300  Nueva  (serie)');
    expect(texto).toContain('Se renombrarían (1):\n  ~ 100.1  «Contratos de obra» -> «Contratos de obra civil»');
    expect(texto).toContain('= 100.2  Interventoría  (subserie, sin documentos; se eliminaría con --eliminar-ausentes)');
    expect(texto).toContain('Sin cambios: 1.');
  });

  it('al aplicar habla en pasado', () => {
    const texto = formatearPlan(plan, { filas, aplicado: true, eliminarAusentes: false });
    expect(texto).toContain('Creadas (1):');
    expect(texto).toContain('Renombradas (1):');
    expect(texto).not.toContain('Se crearían');
  });

  it('explica que lo que tiene documentos nunca se elimina', () => {
    const conservadas = planificar([fila('200', 'Gestión jurídica')], hoy, CON_ELIMINAR);
    const texto = formatearPlan(conservadas, { filas: [fila('200', 'Gestión jurídica')], aplicado: false, eliminarAusentes: true });
    expect(texto).toContain('= 100.1  Contratos de obra  (subserie, 3 documentos: nunca se elimina)');
    expect(texto).toContain('- 100.2  Interventoría  (subserie, sin documentos)');
  });

  it('lista los errores con su línea y los generales sin ella', () => {
    expect(formatearErrores('Hay problemas:', [{ linea: null, mensaje: 'General.' }, { linea: 4, mensaje: 'Código vacío.' }])).toBe(
      'Hay problemas:\n  - General.\n  - línea 4: Código vacío.',
    );
  });
});

describe('detalleDeAuditoria', () => {
  it('cuenta lo creado, renombrado, movido y eliminado y nombra los códigos que se mueven o eliminan', () => {
    const plan = planificar(
      [fila('100', 'Gestión contractual'), fila('100.1', 'Obras civiles', '100'), fila('300', 'Nueva'), fila('300.1', 'Sub', '300')],
      hoy,
      CON_ELIMINAR,
    );
    const detalle = detalleDeAuditoria(plan, { origen: { archivo: 'cuadro.csv', sha256: 'abc123' }, eliminarAusentes: true });
    expect(detalle).toBe(
      'archivo cuadro.csv (sha256 abc123); creadas 2 (1 series, 1 subseries); renombradas 1; movidas 0; ' +
        'eliminadas 3 (100.2, 200.1, 200); ausentes conservadas 0; con --eliminar-ausentes',
    );
  });

  it('no nombra más de 20 códigos', () => {
    const muchas = Array.from({ length: 25 }, (_, i) => actual(100 + i, `X${i}`, `Serie ${i}`));
    const plan = planificar([], muchas, CON_ELIMINAR);
    expect(detalleDeAuditoria(plan, { origen: { archivo: 'a.csv', sha256: 'x' }, eliminarAusentes: true })).toContain('y 5 más');
  });
});
