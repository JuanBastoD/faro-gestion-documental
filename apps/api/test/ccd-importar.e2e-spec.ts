import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { SALIDA, ejecutarImportacion, prepararImportacion, type ImportacionLista } from '../src/ccd/importar/comando.js';
import { validarCuadro, type FilaCuadro } from '../src/ccd/importar/cuadro.js';
import { importarCuadro, leerCuadroActual, type SolicitudImportacion } from '../src/ccd/importar/importar.js';
import { sembrarCcdDemo } from '../src/semilla/ccd-demo.js';
import { crearApp, crearUsuario, eventos, ingresar, limpiarTablas, type AppDePrueba } from './ayudas.js';

const RUTA_EJEMPLO = fileURLToPath(new URL('../../../docs/ejemplos/cuadro-ejemplo.csv', import.meta.url));
const EJEMPLO = readFileSync(RUTA_EJEMPLO, 'utf8');

const CABECERA = 'codigo,nombre,codigo_padre';
const csv = (...filas: string[]) => [CABECERA, ...filas].join('\n');

/** Filas válidas de un CSV (falla la prueba si el CSV no es válido: esas pruebas están en los unitarios). */
function filasDe(texto: string): FilaCuadro[] {
  const lectura = validarCuadro(texto);
  expect(lectura.errores).toEqual([]);
  return lectura.filas;
}

function solicitud(texto: string, opciones: Partial<Pick<SolicitudImportacion, 'aplicar' | 'eliminarAusentes'>> = {}): SolicitudImportacion {
  return {
    filas: filasDe(texto),
    aplicar: opciones.aplicar ?? true,
    eliminarAusentes: opciones.eliminarAusentes ?? false,
    origen: { archivo: 'cuadro.csv', sha256: 'a'.repeat(64) },
  };
}

describe('Importación del cuadro desde CSV (contra PostgreSQL real)', () => {
  let ctx: AppDePrueba;
  let idEditor: number;

  beforeAll(async () => {
    ctx = await crearApp();
  });
  afterAll(async () => {
    // Por si una prueba se interrumpió con el disparador de prueba puesto: que no afecte a los demás archivos.
    await ctx.pool.query('drop trigger if exists prueba_falla_auditoria on auditoria');
    await ctx.pool.query('drop function if exists prueba_falla_auditoria()');
    await ctx.app.close();
  });
  beforeEach(async () => {
    await limpiarTablas(ctx.pool);
    await crearUsuario(ctx.db, { usuario: 'admin', rol: 'administrador' });
    idEditor = await crearUsuario(ctx.db, { usuario: 'editor', rol: 'editor' });
  });

  /** El cuadro como está en la base, para comparar antes y después. */
  const cuadro = async () =>
    (await ctx.pool.query('select id, codigo, nombre, padre_id from series_ccd order by id')).rows as Array<{
      id: number;
      codigo: string;
      nombre: string;
      padre_id: number | null;
    }>;
  const totalAuditoria = async () => (await ctx.pool.query('select count(*)::int as n from auditoria')).rows[0].n as number;
  const idDe = async (codigo: string) => (await ctx.pool.query('select id from series_ccd where codigo = $1', [codigo])).rows[0]?.id as number;
  const conDocumentos = async (codigoSubserie: string, cuantos = 1) => {
    const serieId = await idDe(codigoSubserie);
    for (let i = 0; i < cuantos; i++) {
      await ctx.pool.query(
        `insert into documentos (titulo, expediente, serie_id, fecha_documento, creado_por)
         values ('Acta de prueba', 'EXP-1', $1, '2026-11-01', $2)`,
        [serieId, idEditor],
      );
    }
  };

  describe('importar', () => {
    it('crea el CSV de ejemplo completo: 5 series y 10 subseries con su jerarquía', async () => {
      const { plan, aplicado } = await importarCuadro(ctx.db, solicitud(EJEMPLO));
      expect(aplicado).toBe(true);
      expect(plan.crear).toHaveLength(15);

      const filas = await cuadro();
      expect(filas).toHaveLength(15);
      const porCodigo = new Map(filas.map((f) => [f.codigo, f]));
      expect(filas.filter((f) => f.padre_id === null).map((f) => f.codigo).sort()).toEqual(['100', '200', '300', '400', '500']);
      expect(porCodigo.get('100.3')).toMatchObject({ nombre: 'Contratos de suministro', padre_id: porCodigo.get('100')?.id });
      expect(porCodigo.get('500.1')).toMatchObject({ nombre: 'Licencias y permisos', padre_id: porCodigo.get('500')?.id });
    });

    it('la subserie puede venir antes que su serie en el archivo', async () => {
      await importarCuadro(ctx.db, solicitud(csv('100.1,Obras,100', '100,Gestión,')));
      // Las series se escriben antes que las subseries, así que 100 recibe el identificador menor.
      expect((await cuadro()).map((f) => [f.codigo, f.padre_id === null])).toEqual([
        ['100', true],
        ['100.1', false],
      ]);
    });

    it('deja un evento de auditoría sin autor con las cantidades, el archivo y su huella', async () => {
      await importarCuadro(ctx.db, solicitud(EJEMPLO));
      const registrados = await eventos(ctx.pool, 'ccd_importado');
      expect(registrados).toHaveLength(1);
      expect(registrados[0].usuario_id).toBeNull();
      expect(registrados[0].detalle).toBe(
        `archivo cuadro.csv (sha256 ${'a'.repeat(64)}); creadas 15 (5 series, 10 subseries); renombradas 0; movidas 0; eliminadas 0; ausentes conservadas 0`,
      );
    });

    it('el administrador ve el evento en GET /auditoria, filtrando por la acción', async () => {
      await importarCuadro(ctx.db, solicitud(EJEMPLO));
      const cookie = await ingresar(ctx.app, 'admin');
      const { body } = await request(ctx.app.getHttpServer()).get('/auditoria?accion=ccd_importado').set('Cookie', cookie).expect(200);
      expect(body.total).toBe(1);
      expect(body.items[0]).toMatchObject({ accion: 'ccd_importado', usuarioId: null, usuario: null });
    });

    it('sobre el cuadro de la siembra solo agrega lo nuevo y conserva los identificadores de lo que ya había', async () => {
      await sembrarCcdDemo(ctx.db);
      const antes = await cuadro();
      expect(antes).toHaveLength(9);
      const { plan } = await importarCuadro(ctx.db, solicitud(EJEMPLO));
      expect(plan.crear.map((f) => f.codigo).sort()).toEqual(['100.3', '200.2', '300.2', '400.2', '500', '500.1']);
      expect(plan.sinCambios).toBe(9);
      const despues = await cuadro();
      expect(despues).toHaveLength(15);
      expect(despues.slice(0, 9)).toEqual(antes);
    });
  });

  describe('es idempotente', () => {
    it('repetir el mismo CSV no cambia la base ni agrega eventos de auditoría', async () => {
      await importarCuadro(ctx.db, solicitud(EJEMPLO));
      const filasAntes = await cuadro();
      const auditoriaAntes = await totalAuditoria();

      for (const eliminarAusentes of [false, true]) {
        const { plan, aplicado } = await importarCuadro(ctx.db, solicitud(EJEMPLO, { eliminarAusentes }));
        expect(aplicado).toBe(false);
        expect(plan.sinCambios).toBe(15);
        expect([plan.crear, plan.renombrar, plan.mover, plan.eliminar, plan.conservadas, plan.conflictos]).toEqual([[], [], [], [], [], []]);
      }
      expect(await cuadro()).toEqual(filasAntes);
      expect(await totalAuditoria()).toBe(auditoriaAntes);
    });
  });

  describe('sin aplicar solo muestra', () => {
    it('calcula el plan y no escribe nada (ni el cuadro ni la auditoría)', async () => {
      await sembrarCcdDemo(ctx.db);
      const filasAntes = await cuadro();
      const { plan, aplicado } = await importarCuadro(ctx.db, solicitud(EJEMPLO, { aplicar: false }));
      expect(aplicado).toBe(false);
      expect(plan.crear).toHaveLength(6);
      expect(await cuadro()).toEqual(filasAntes);
      expect(await totalAuditoria()).toBe(0);
    });
  });

  describe('renombrar', () => {
    it('cambia el nombre por código sin cambiar el identificador, aunque la subserie tenga documentos', async () => {
      await sembrarCcdDemo(ctx.db);
      await conDocumentos('100.1', 2);
      const id = await idDe('100.1');
      const { plan, aplicado } = await importarCuadro(
        ctx.db,
        solicitud(csv('100,Gestión contractual,', '100.1,Contratos de obra civil,100'), { aplicar: true }),
      );
      expect(aplicado).toBe(true);
      expect(plan.renombrar).toEqual([{ codigo: '100.1', nombreActual: 'Contratos de obra', nombreNuevo: 'Contratos de obra civil' }]);
      expect(await idDe('100.1')).toBe(id);
      expect((await ctx.pool.query('select nombre from series_ccd where id = $1', [id])).rows[0].nombre).toBe('Contratos de obra civil');
      expect((await ctx.pool.query('select count(*)::int as n from documentos where serie_id = $1', [id])).rows[0].n).toBe(2);
    });
  });

  describe('una subserie con documentos no se mueve ni se elimina', () => {
    const propuesta = (...filas: string[]) => csv('100,Gestión contractual,', '200,Gestión jurídica,', ...filas);

    beforeEach(async () => {
      await sembrarCcdDemo(ctx.db);
      await conDocumentos('100.1', 3);
    });

    it('mover una subserie con documentos a otra serie se niega y no escribe NADA, ni siquiera lo que sí era válido', async () => {
      const antes = await cuadro();
      const { plan, aplicado } = await importarCuadro(
        ctx.db,
        solicitud(
          propuesta('100.1,Contratos de obra,200', '500,Una serie nueva válida,', '100.2,Interventoría con otro nombre,100'),
          { aplicar: true },
        ),
      );
      expect(aplicado).toBe(false);
      expect(plan.conflictos).toHaveLength(1);
      expect(plan.conflictos[0].mensaje).toMatch(/100\.1 tiene 3 documentos .* de la serie 100 a la 200/);
      // Todo o nada: la serie nueva y el nombre nuevo de 100.2 tampoco se aplicaron.
      expect(await cuadro()).toEqual(antes);
      expect(await totalAuditoria()).toBe(0);
    });

    it('mover una subserie SIN documentos sí se permite', async () => {
      const { aplicado } = await importarCuadro(
        ctx.db,
        solicitud(propuesta('100.1,Contratos de obra,100', '100.2,Interventoría,200', '200.1,Conceptos jurídicos,200'), { aplicar: true }),
      );
      expect(aplicado).toBe(true);
      expect((await ctx.pool.query(`select padre_id from series_ccd where codigo = '100.2'`)).rows[0].padre_id).toBe(await idDe('200'));
    });

    it('con --eliminar-ausentes no elimina la subserie con documentos ni su serie, pero sí lo que no tiene', async () => {
      // El archivo solo trae la serie 200: 100 (por 100.1 con documentos) y 100.1 se conservan; 100.2 y 300.x se eliminan.
      const { plan, aplicado } = await importarCuadro(
        ctx.db,
        solicitud(csv('200,Gestión jurídica,', '200.1,Conceptos jurídicos,200'), { aplicar: true, eliminarAusentes: true }),
      );
      expect(aplicado).toBe(true);
      expect(plan.conservadas.map((a) => [a.codigo, a.documentos])).toEqual([
        ['100', 3],
        ['100.1', 3],
      ]);
      expect((await cuadro()).map((f) => f.codigo).sort()).toEqual(['100', '100.1', '200', '200.1']);
      expect((await ctx.pool.query('select count(*)::int as n from documentos')).rows[0].n).toBe(3);
    });

    it('un código existente no cambia de nivel: ni una subserie con documentos pasa a serie ni una serie a subserie', async () => {
      const antes = await cuadro();
      const resultado = await importarCuadro(
        ctx.db,
        solicitud(csv('100,Gestión contractual,', '100.1,Contratos de obra,', '200,Gestión jurídica,100'), { aplicar: true }),
      );
      expect(resultado.aplicado).toBe(false);
      expect(resultado.plan.conflictos).toHaveLength(2);
      expect(resultado.plan.conflictos[0].mensaje).toContain('100.1 es una subserie en la base y el archivo la declara serie');
      expect(resultado.plan.conflictos[1].mensaje).toContain('200 es una serie en la base y el archivo la declara subserie');
      expect(await cuadro()).toEqual(antes);
    });
  });

  describe('--eliminar-ausentes', () => {
    beforeEach(async () => {
      await sembrarCcdDemo(ctx.db);
    });
    const parcial = csv('100,Gestión contractual,', '100.1,Contratos de obra,100');

    it('sin la opción informa lo ausente y no borra nada', async () => {
      const antes = await cuadro();
      const { plan, aplicado } = await importarCuadro(ctx.db, solicitud(parcial));
      expect(aplicado).toBe(false);
      expect(plan.conservadas.map((a) => a.codigo)).toEqual(['100.2', '200', '200.1', '300', '300.1', '400', '400.1']);
      expect(plan.eliminar).toEqual([]);
      expect(await cuadro()).toEqual(antes);
    });

    it('con la opción elimina lo ausente que no tiene documentos (subseries primero) y lo audita', async () => {
      const { plan, aplicado } = await importarCuadro(ctx.db, solicitud(parcial, { eliminarAusentes: true }));
      expect(aplicado).toBe(true);
      expect(plan.eliminar).toHaveLength(7);
      expect((await cuadro()).map((f) => f.codigo).sort()).toEqual(['100', '100.1']);
      const [evento] = await eventos(ctx.pool, 'ccd_importado');
      expect(evento.detalle).toContain('eliminadas 7 (100.2, 200.1, 300.1, 400.1, 200, 300, 400)');
      expect(evento.detalle).toContain('con --eliminar-ausentes');
    });

    it('si hay documentos en una serie ausente, se eliminan las demás y esa queda', async () => {
      await conDocumentos('300.1');
      await importarCuadro(ctx.db, solicitud(parcial, { eliminarAusentes: true }));
      expect((await cuadro()).map((f) => f.codigo).sort()).toEqual(['100', '100.1', '300', '300.1']);
    });
  });

  describe('todo o nada', () => {
    it('un CSV inválido no llega a la base: el comando lo detiene al validar y la base queda idéntica', async () => {
      await sembrarCcdDemo(ctx.db);
      const antes = await cuadro();
      const carpeta = mkdtempSync(join(tmpdir(), 'faro-ccd-e2e-'));
      try {
        const archivo = join(carpeta, 'malo.csv');
        // Una serie válida y nueva, un nombre cambiado y dos errores: nada de eso debe escribirse.
        writeFileSync(archivo, csv('500,Nueva serie válida,', '100,Gestión contractual renombrada,', '100,Repetida,', '999.1,Sub,999'));
        const preparacion = prepararImportacion([archivo, '--aplicar', '--eliminar-ausentes'], carpeta);
        expect(preparacion.tipo).toBe('invalido');
        if (preparacion.tipo === 'invalido') expect(preparacion.errores).toHaveLength(2);
      } finally {
        rmSync(carpeta, { recursive: true, force: true });
      }
      expect(await cuadro()).toEqual(antes);
      expect(await totalAuditoria()).toBe(0);
    });

    it('si algo falla a mitad de la escritura (aquí, el evento de auditoría) se deshace TODO', async () => {
      await sembrarCcdDemo(ctx.db);
      await conDocumentos('100.1');
      const antes = await cuadro();
      // Un disparador de prueba hace fallar el último paso de la transacción; se quita en el finally.
      await ctx.pool.query(
        `create function prueba_falla_auditoria() returns trigger as $$ begin raise exception 'fallo simulado'; end; $$ language plpgsql`,
      );
      await ctx.pool.query('create trigger prueba_falla_auditoria before insert on auditoria for each row execute function prueba_falla_auditoria()');
      try {
        const error = await importarCuadro(
          ctx.db,
          solicitud(
            csv('100,Gestión contractual renombrada,', '100.1,Contratos de obra,100', '500,Nueva,', '500.1,Nueva sub,500'),
            { eliminarAusentes: true },
          ),
        ).catch((e: unknown) => e as Error & { cause?: Error });
        // Drizzle envuelve el error de PostgreSQL: el texto del disparador está en `cause`.
        expect(error).toBeInstanceOf(Error);
        expect((error as Error & { cause?: Error }).cause?.message).toContain('fallo simulado');
      } finally {
        await ctx.pool.query('drop trigger prueba_falla_auditoria on auditoria');
        await ctx.pool.query('drop function prueba_falla_auditoria()');
      }
      expect(await cuadro()).toEqual(antes);
    });
  });

  describe('concurrencia con la carga de documentos', () => {
    it('espera a un documento que se está cargando y, al contarlo, se niega a mover su subserie', async () => {
      await sembrarCcdDemo(ctx.db);
      const serieId = await idDe('100.2');
      const antes = await cuadro();

      const cliente = await ctx.pool.connect();
      try {
        // Un documento nuevo en 100.2, todavía sin confirmar: toma un bloqueo compartido de esa subserie.
        await cliente.query('begin');
        await cliente.query(
          `insert into documentos (titulo, expediente, serie_id, fecha_documento, creado_por)
           values ('Carga en curso', 'EXP-9', $1, '2026-11-02', $2)`,
          [serieId, idEditor],
        );

        // Mover 100.2 a la serie 200: la lectura previa (sin ver el documento sin confirmar) diría «0 documentos».
        const importacion = importarCuadro(
          ctx.db,
          solicitud(csv('100,Gestión contractual,', '100.2,Interventoría,200', '200,Gestión jurídica,'), { aplicar: true }),
        );
        let terminada = false;
        void importacion.then(
          () => (terminada = true),
          () => (terminada = true),
        );
        await new Promise((resolver) => setTimeout(resolver, 500));
        expect(terminada, 'la importación debe esperar al documento que se está cargando').toBe(false);

        await cliente.query('commit');
        const { plan, aplicado } = await importacion;
        expect(aplicado).toBe(false);
        expect(plan.conflictos[0].mensaje).toContain('100.2 tiene 1 documento');
      } finally {
        cliente.release();
      }
      expect(await cuadro()).toEqual(antes);
    });
  });

  describe('el comando (ejecutarImportacion): lo que se imprime y el código de salida', () => {
    const capturar = () => {
      const salida = { info: [] as string[], error: [] as string[] };
      return { salida, io: { info: (t: string) => void salida.info.push(t), error: (t: string) => void salida.error.push(t) } };
    };
    const lista = (texto: string, opciones: Partial<Pick<SolicitudImportacion, 'aplicar' | 'eliminarAusentes'>> = {}): ImportacionLista => ({
      archivo: 'cuadro.csv',
      avisos: [],
      solicitud: solicitud(texto, opciones),
    });

    it('sin --aplicar imprime una simulación, sale con 0 y no escribe', async () => {
      const { salida, io } = capturar();
      const codigo = await ejecutarImportacion(ctx.db, lista(EJEMPLO, { aplicar: false }), io);
      expect(codigo).toBe(SALIDA.OK);
      expect(salida.info.join('\n')).toContain('SIMULACIÓN con cuadro.csv: no se escribió nada.');
      expect(salida.info.join('\n')).toContain('Se crearían (15):');
      expect(salida.info.join('\n')).toContain('repite el comando con --aplicar');
      expect(await cuadro()).toEqual([]);
    });

    it('con --aplicar imprime lo hecho y sale con 0; repetirlo dice que no hay nada que cambiar', async () => {
      const primero = capturar();
      expect(await ejecutarImportacion(ctx.db, lista(EJEMPLO), primero.io)).toBe(SALIDA.OK);
      expect(primero.salida.info.join('\n')).toContain('Importación aplicada desde cuadro.csv.');
      expect(primero.salida.info.join('\n')).toContain('Creadas (15):');
      expect(await cuadro()).toHaveLength(15);

      const segundo = capturar();
      expect(await ejecutarImportacion(ctx.db, lista(EJEMPLO), segundo.io)).toBe(SALIDA.OK);
      expect(segundo.salida.info.join('\n')).toContain('no hay nada que cambiar');
      expect(await totalAuditoria()).toBe(1);
    });

    it('un conflicto con documentos sale con 1, lo dice por el canal de errores y no escribe, con o sin --aplicar', async () => {
      await sembrarCcdDemo(ctx.db);
      await conDocumentos('100.1');
      const antes = await cuadro();
      const texto = csv('100,Gestión contractual,', '200,Gestión jurídica,', '100.1,Contratos de obra,200');
      for (const aplicar of [false, true]) {
        const { salida, io } = capturar();
        expect(await ejecutarImportacion(ctx.db, lista(texto, { aplicar }), io)).toBe(SALIDA.RECHAZADO);
        expect(salida.info).toEqual([]);
        expect(salida.error.join('\n')).toContain('No se importó nada');
        expect(salida.error.join('\n')).toContain('línea 4: 100.1 tiene 1 documento');
        expect(await cuadro()).toEqual(antes);
      }
    });
  });

  describe('leerCuadroActual', () => {
    it('traduce el padre a su código y cuenta los documentos de cada subserie', async () => {
      await sembrarCcdDemo(ctx.db);
      await conDocumentos('400.1', 2);
      const actual = await leerCuadroActual(ctx.db);
      expect(actual.find((s) => s.codigo === '400.1')).toMatchObject({ padreCodigo: '400', documentos: 2 });
      expect(actual.find((s) => s.codigo === '400')).toMatchObject({ padreCodigo: null, documentos: 0 });
    });
  });
});
