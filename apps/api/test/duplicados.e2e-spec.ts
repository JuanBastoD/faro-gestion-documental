import { createHash } from 'node:crypto';
import request from 'supertest';
import { claveDeObjeto } from '../src/documentos/archivo-preparado.js';
import { sembrarCcdDemo } from '../src/semilla/ccd-demo.js';
import {
  crearApp,
  crearUsuario,
  eventos,
  ingresar,
  limpiarTablas,
  type AppDePrueba,
} from './ayudas.js';
import {
  conErroresDeOcr,
  conOtrosDatos,
  generarPdf,
  palabrasFicticias,
  pdfConTexto,
  pdfSinTexto,
} from './pdfs.js';

const sha256 = (datos: Buffer) => createHash('sha256').update(datos).digest('hex');

interface Candidato {
  documentoId: number;
  version: number;
  titulo: string;
  expediente: string;
  serieCodigo: string;
  similitud: number;
}

describe('Verificación doble de duplicados (contra PostgreSQL real)', () => {
  let ctx: AppDePrueba;
  let cookieEditor: string;
  let cookieLector: string;
  let subserie: number;

  // El documento original, su reescaneo simulado (mismo texto, otros metadatos y un 1 % de errores de OCR),
  // un documento con la misma plantilla pero otros datos (15 %) y uno sin relación.
  const palabras = palabrasFicticias(3000, 101);
  let original: Buffer;
  let reescaneo: Buffer;
  let mismaPlantilla: Buffer;
  let sinRelacion: Buffer;
  let escaneadoSinTexto: Buffer;

  beforeAll(async () => {
    ctx = await crearApp();
    original = await pdfConTexto(palabras, { creado: new Date('2026-03-02T10:00:00Z'), productor: 'Escáner A' });
    reescaneo = await pdfConTexto(conErroresDeOcr(palabras, 0.01, 5), {
      creado: new Date('2026-05-20T16:30:00Z'),
      productor: 'Escáner B',
    });
    mismaPlantilla = await pdfConTexto(conOtrosDatos(palabras, 0.15, 6));
    sinRelacion = await pdfConTexto(palabrasFicticias(3000, 202));
    escaneadoSinTexto = await pdfSinTexto();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await limpiarTablas(ctx.pool);
    for (const objeto of await ctx.almacen.listar('documentos/')) await ctx.almacen.borrar(objeto.clave);
    await crearUsuario(ctx.db, { usuario: 'editor', rol: 'editor' });
    await crearUsuario(ctx.db, { usuario: 'lector', rol: 'consulta' });
    await sembrarCcdDemo(ctx.db);
    const { rows } = await ctx.pool.query(`select id from series_ccd where codigo = '100.1'`);
    subserie = rows[0].id;
    cookieEditor = await ingresar(ctx.app, 'editor');
    cookieLector = await ingresar(ctx.app, 'lector');
  });

  const http = () => request(ctx.app.getHttpServer());

  function cargar(archivo: Buffer, campos: Record<string, string | undefined> = {}, cookie = cookieEditor) {
    const datos: Record<string, string | undefined> = {
      titulo: 'Contrato de obra',
      expediente: 'EXP-100',
      serieId: String(subserie),
      fechaDocumento: '2026-03-02',
      ...campos,
    };
    let peticion = http().post('/documentos').set('Cookie', cookie);
    for (const [campo, valor] of Object.entries(datos)) {
      if (valor !== undefined) peticion = peticion.field(campo, valor);
    }
    return peticion.attach('archivo', archivo, { filename: 'escaneo.pdf', contentType: 'application/pdf' });
  }

  /** Eventos de decisión con el documento al que quedaron asociados. */
  const decisiones = async () =>
    (await ctx.pool.query(`select documento_id, detalle from auditoria where accion = 'decision_duplicado' order by id`)).rows as Array<{ documento_id: number; detalle: string }>;

  const contar = async (tabla: 'documentos' | 'versiones') =>
    (await ctx.pool.query(`select count(*)::int as n from ${tabla}`)).rows[0].n as number;

  async function cargarOriginal(): Promise<number> {
    const { body } = await cargar(original).expect(201);
    return body.documento.id as number;
  }

  describe('SHA-256 igual: se bloquea y se dice dónde está', () => {
    it('409 duplicado_exacto con la ubicación del existente; no crea nada', async () => {
      const id = await cargarOriginal();
      const { body } = await cargar(original, { titulo: 'Copia', expediente: 'EXP-OTRO' }).expect(409);
      expect(body).toMatchObject({
        statusCode: 409,
        codigo: 'duplicado_exacto',
        existente: { documentoId: id, version: 1, titulo: 'Contrato de obra', expediente: 'EXP-100', serieCodigo: '100.1' },
      });
      expect(body.message).toContain(`documento ${id}`);
      expect(await contar('documentos')).toBe(1);
      expect(await contar('versiones')).toBe(1);
    });

    it('también si el existente es una versión vieja de otro documento', async () => {
      const id = await cargarOriginal();
      await http()
        .post(`/documentos/${id}/versiones`)
        .set('Cookie', cookieEditor)
        .field('motivo', 'Segunda')
        .attach('archivo', sinRelacion, { filename: 'v2.pdf', contentType: 'application/pdf' })
        .expect(201);
      const { body } = await cargar(original, { titulo: 'Copia de la primera versión' }).expect(409);
      expect(body).toMatchObject({ codigo: 'duplicado_exacto', existente: { documentoId: id, version: 1 } });
    });

    it('una decisión no sirve para saltarse el bloqueo exacto', async () => {
      await cargarOriginal();
      await cargar(original, { decision: 'documento_distinto', justificacion: 'Es otro' }).expect(409);
      expect(await contar('documentos')).toBe(1);
    });

    it('un archivo no PDF se rechaza antes de verificar nada (415)', async () => {
      await cargar(Buffer.from('texto plano')).expect(415);
    });

    it('dos cargas idénticas simultáneas: una gana y la otra recibe 409, y queda un solo documento', async () => {
      const [a, b] = await Promise.all([cargar(original, { titulo: 'A' }), cargar(original, { titulo: 'B' })]);
      expect([a.status, b.status].sort((x, y) => x - y)).toEqual([201, 409]);
      expect(await contar('documentos')).toBe(1);
      expect(await ctx.almacen.existe(claveDeObjeto(sha256(original)))).toBe(true);
    });
  });

  describe('SHA distinto y texto muy parecido: aviso con ambos documentos, decide la persona', () => {
    it('un reescaneo simulado da 409 duplicado_probable con el candidato y su similitud', async () => {
      const id = await cargarOriginal();
      expect(sha256(reescaneo)).not.toBe(sha256(original));

      const { body } = await cargar(reescaneo, { titulo: 'Contrato escaneado otra vez' }).expect(409);
      expect(body.codigo).toBe('duplicado_probable');
      expect(body.umbral).toBe(0.8);
      expect(body.candidatos).toHaveLength(1);
      expect(body.candidatos[0]).toMatchObject({
        documentoId: id,
        version: 1,
        titulo: 'Contrato de obra',
        expediente: 'EXP-100',
        serieCodigo: '100.1',
      });
      expect(body.candidatos[0].similitud).toBeGreaterThanOrEqual(0.9);
      expect(body.candidatos[0].similitud).toBeLessThanOrEqual(1);
      expect(body.message).toMatch(/nueva_version/);
      // No guardó nada: ni documento ni objeto del reescaneo.
      expect(await contar('documentos')).toBe(1);
      expect(await ctx.almacen.existe(claveDeObjeto(sha256(reescaneo)))).toBe(false);
    });

    it('la similitud nunca bloquea sola: con decision=documento_distinto se carga como documento nuevo', async () => {
      const id = await cargarOriginal();
      const { body } = await cargar(reescaneo, {
        titulo: 'Contrato escaneado otra vez',
        decision: 'documento_distinto',
        justificacion: 'Es el contrato del segundo lote, con la misma plantilla',
      }).expect(201);
      expect(body.documento.id).not.toBe(id);
      expect(body.version).toMatchObject({ numero: 1, textoEstado: 'ok' });
      expect(await contar('documentos')).toBe(2);
      expect(await ctx.almacen.existe(claveDeObjeto(sha256(reescaneo)))).toBe(true);

      const [decision] = await decisiones();
      expect(decision.documento_id).toBe(body.documento.id);
      expect(decision.detalle).toContain('documento_distinto');
      expect(decision.detalle).toContain(`${id} v1 (`);
      expect(decision.detalle).toContain('Es el contrato del segundo lote');
    });

    it('con decision=nueva_version se agrega como versión del documento elegido', async () => {
      const id = await cargarOriginal();
      const { body } = await cargar(reescaneo, {
        decision: 'nueva_version',
        documentoId: String(id),
        motivo: 'Mejor calidad de escaneo',
      }).expect(201);
      expect(body.documento.id).toBe(id);
      expect(body.version).toMatchObject({
        numero: 2,
        motivo: 'Mejor calidad de escaneo',
        sha256: sha256(reescaneo),
        textoEstado: 'ok',
        autor: 'editor',
      });
      expect(await contar('documentos')).toBe(1);
      expect(await contar('versiones')).toBe(2);

      const historial = (await http().get(`/documentos/${id}/versiones`).set('Cookie', cookieLector).expect(200)).body;
      expect(historial.map((v: { numero: number }) => v.numero)).toEqual([2, 1]);
      // Dos eventos en la misma transacción: la versión y la decisión.
      expect(await eventos(ctx.pool, 'version')).toHaveLength(1);
      const [decision] = await decisiones();
      expect(decision.documento_id).toBe(id);
      expect(decision.detalle).toContain(`nueva_version del documento ${id}`);
    });

    it('nueva_version a un documento que no existe → 404 y no queda nada guardado', async () => {
      await cargarOriginal();
      await cargar(reescaneo, { decision: 'nueva_version', documentoId: '99999', motivo: 'x' }).expect(404);
      expect(await contar('versiones')).toBe(1);
      expect(await ctx.almacen.existe(claveDeObjeto(sha256(reescaneo)))).toBe(false);
      expect(await eventos(ctx.pool, 'decision_duplicado')).toHaveLength(0);
    });

    it('una decisión incompleta se rechaza con 400 antes de tocar nada', async () => {
      const id = await cargarOriginal();
      await cargar(reescaneo, { decision: 'documento_distinto' }).expect(400); // sin justificación
      await cargar(reescaneo, { decision: 'nueva_version', documentoId: String(id) }).expect(400); // sin motivo
      await cargar(reescaneo, { decision: 'nueva_version', motivo: 'x' }).expect(400); // sin documento
      await cargar(reescaneo, { decision: 'ignorar' }).expect(400);
      expect(await contar('versiones')).toBe(1);
      expect(await eventos(ctx.pool, 'decision_duplicado')).toHaveLength(0);
    });

    it('si la decisión no se pudo registrar, la carga tampoco: todo en una transacción', async () => {
      await cargarOriginal();
      const { AuditoriaService } = await import('../src/auditoria/auditoria.service.js');
      const auditoria = ctx.app.get(AuditoriaService);
      const original = auditoria.registrar.bind(auditoria);
      const espia = vi.spyOn(auditoria, 'registrar').mockImplementation(async (evento, ejecutor) => {
        if (evento.accion === 'decision_duplicado') throw new Error('falla simulada de auditoría');
        return original(evento, ejecutor);
      });
      try {
        await cargar(reescaneo, { decision: 'documento_distinto', justificacion: 'Otro lote' }).expect(500);
      } finally {
        espia.mockRestore();
      }
      expect(await contar('documentos')).toBe(1);
      expect(await ctx.almacen.existe(claveDeObjeto(sha256(reescaneo)))).toBe(false);
    });

    it('el rol de consulta no puede decidir nada: 403', async () => {
      const id = await cargarOriginal();
      await cargar(reescaneo, { decision: 'nueva_version', documentoId: String(id), motivo: 'x' }, cookieLector).expect(403);
      expect(await contar('versiones')).toBe(1);
    });

    it('solo se muestran los candidatos que pasan el umbral, el más parecido primero y uno por documento', async () => {
      const id = await cargarOriginal();
      // Una segunda versión del mismo documento con casi el mismo texto no duplica al candidato.
      await http()
        .post(`/documentos/${id}/versiones`)
        .set('Cookie', cookieEditor)
        .field('motivo', 'Correcciones menores')
        .attach('archivo', await pdfConTexto(conErroresDeOcr(palabras, 0.005, 9)), { filename: 'v2.pdf', contentType: 'application/pdf' })
        .expect(201);
      // Otro documento sin relación no aparece.
      await cargar(sinRelacion, { titulo: 'Documento sin relación', expediente: 'EXP-9' }).expect(201);

      const { body } = await cargar(reescaneo).expect(409);
      expect(body.candidatos.map((c: Candidato) => c.documentoId)).toEqual([id]);
    });
  });

  describe('SHA distinto y texto distinto: documento nuevo', () => {
    it('un documento sin relación se carga sin aviso, aunque ya haya otros', async () => {
      await cargarOriginal();
      const { body } = await cargar(sinRelacion, { titulo: 'Otro contrato', expediente: 'EXP-200' }).expect(201);
      expect(body.version.textoEstado).toBe('ok');
      expect(await contar('documentos')).toBe(2);
      expect(await eventos(ctx.pool, 'decision_duplicado')).toHaveLength(0);
    });

    it('la misma plantilla con otros datos (15 %) no se confunde con un reescaneo', async () => {
      await cargarOriginal();
      await cargar(mismaPlantilla, { titulo: 'Contrato del segundo lote', expediente: 'EXP-300' }).expect(201);
      expect(await contar('documentos')).toBe(2);
    });
  });

  describe('PDF sin capa de texto: se marca y solo se verifica por huella', () => {
    it('queda marcado sin_texto y no se compara con nada', async () => {
      const { body } = await cargar(escaneadoSinTexto, { titulo: 'Plano escaneado' }).expect(201);
      expect(body.version.textoEstado).toBe('sin_texto');
      const { rows } = await ctx.pool.query(`select texto_estado, texto_normalizado, firma from versiones`);
      expect(rows[0]).toEqual({ texto_estado: 'sin_texto', texto_normalizado: null, firma: null });
    });

    it('un segundo escaneo distinto sin texto se carga: no hay con qué compararlo', async () => {
      await cargar(escaneadoSinTexto, { titulo: 'Plano A' }).expect(201);
      const otro = await pdfSinTexto({ creado: new Date('2026-06-01T00:00:00Z'), productor: 'Otro escáner' });
      await cargar(otro, { titulo: 'Plano A reescaneado', expediente: 'EXP-400' }).expect(201);
      expect(await contar('documentos')).toBe(2);
    });

    it('el mismo PDF sin texto sí es un duplicado exacto', async () => {
      await cargar(escaneadoSinTexto, { titulo: 'Plano A' }).expect(201);
      const { body } = await cargar(escaneadoSinTexto, { titulo: 'Plano A otra vez' }).expect(409);
      expect(body.codigo).toBe('duplicado_exacto');
    });

    it('un PDF con muy poco texto (carátula) también se trata como sin_texto', async () => {
      const { body } = await cargar(generarPdf(['Acta de inicio', 'Contrato DEMO-001'])).expect(201);
      expect(body.version.textoEstado).toBe('sin_texto');
    });

    it('un PDF sin texto no impide que otros documentos con texto se comparen entre sí', async () => {
      await cargar(escaneadoSinTexto, { titulo: 'Plano' }).expect(201);
      await cargarOriginal();
      await cargar(reescaneo).expect(409);
    });
  });

  describe('restauraciones y versiones nuevas conservan la verificación', () => {
    it('una restauración copia el texto y no cuenta dos veces al candidato', async () => {
      const id = await cargarOriginal();
      await http()
        .post(`/documentos/${id}/versiones`)
        .set('Cookie', cookieEditor)
        .field('motivo', 'Segunda')
        .attach('archivo', sinRelacion, { filename: 'v2.pdf', contentType: 'application/pdf' })
        .expect(201);
      const restaurada = await http()
        .post(`/documentos/${id}/versiones/1/restaurar`)
        .set('Cookie', cookieEditor)
        .send({})
        .expect(201);
      expect(restaurada.body.textoEstado).toBe('ok');
      const { rows } = await ctx.pool.query(
        `select numero, texto_estado, firma = (select firma from versiones where numero = 1) as misma_firma
           from versiones order by numero`,
      );
      expect(rows[2]).toEqual({ numero: 3, texto_estado: 'ok', misma_firma: true });

      const { body } = await cargar(reescaneo).expect(409);
      expect(body.candidatos).toHaveLength(1);
    });

    it('una versión nueva guarda su texto y puede ser candidata de un reescaneo posterior', async () => {
      const id = await cargarOriginal();
      const nueva = await pdfConTexto(palabrasFicticias(3000, 303));
      await http()
        .post(`/documentos/${id}/versiones`)
        .set('Cookie', cookieEditor)
        .field('motivo', 'Contenido nuevo')
        .attach('archivo', nueva, { filename: 'v2.pdf', contentType: 'application/pdf' })
        .expect(201);
      const reescaneoDeLaNueva = await pdfConTexto(conErroresDeOcr(palabrasFicticias(3000, 303), 0.01, 11), {
        productor: 'Otro escáner',
      });
      const { body } = await cargar(reescaneoDeLaNueva, { titulo: 'Reescaneo de la versión 2' }).expect(409);
      expect(body.candidatos[0]).toMatchObject({ documentoId: id, version: 2 });
    });
  });

  describe('rendimiento con un documento de unas 100 páginas', () => {
    it('cargar un PDF de 100 páginas y detectar su reescaneo cabe en unos pocos segundos', async () => {
      const largo = palabrasFicticias(60000, 404); // 60 000 palabras ≈ 100 páginas de 600
      const pdf = await pdfConTexto(largo);
      const reescaneoLargo = await pdfConTexto(conErroresDeOcr(largo, 0.01, 12), { productor: 'Otro escáner' });

      const t0 = performance.now();
      await cargar(pdf, { titulo: 'Expediente largo' }).expect(201);
      const cargaMs = performance.now() - t0;
      const t1 = performance.now();
      await cargar(reescaneoLargo).expect(409);
      const deteccionMs = performance.now() - t1;
      console.log(`PDF de ~100 páginas: carga ${cargaMs.toFixed(0)} ms; detección del reescaneo ${deteccionMs.toFixed(0)} ms`);
      // Cota holgada para no dar falsas alarmas en una máquina lenta: el objetivo del plan es < 2 s.
      expect(deteccionMs).toBeLessThan(15000);
    }, 90000);
  });
});
