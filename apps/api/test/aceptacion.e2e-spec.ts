/**
 * Pruebas de aceptación: las 7 del prototipo v1 (legacy/prototipo-v1/test/flujo.test.js) contra la API
 * nueva, encadenadas como en v1: cada una usa lo que dejaron las anteriores. Contra PostgreSQL real.
 *
 * Qué cambió respecto a v1, a propósito:
 *  - v1 respondía con páginas HTML y redirecciones; la API responde con códigos y JSON (una petición
 *    sin sesión es 401, no un 302 a /login).
 *  - Un archivo que no es PDF es 415 (Unsupported Media Type), no 400.
 *  - Un archivo idéntico se rechaza con 409 y dice dónde está, y la versión nueva de la prueba 4
 *    cubre además el reescaneo (similitud de texto) que v1 no detectaba.
 *  - La prueba 7 reinicia la aplicación de verdad: cierra la instancia y levanta otra contra la misma
 *    base de datos y el mismo almacén de archivos.
 */
import request from 'supertest';
import { sembrarCcdDemo } from '../src/semilla/ccd-demo.js';
import {
  CLAVE_DE_PRUEBA,
  crearApp,
  crearUsuario,
  ingresar,
  limpiarTablas,
  type AppDePrueba,
} from './ayudas.js';
import { conErroresDeOcr, generarPdf, palabrasFicticias, pdfConTexto } from './pdfs.js';

interface Evento {
  accion: string;
  detalle: string | null;
  usuarioId: number | null;
  documentoId: number | null;
}

describe('Pruebas de aceptación (las 7 de v1 contra la API nueva)', () => {
  let ctx: AppDePrueba;
  let subserie: number;
  let cookieEditor: string;
  let cookieConsulta: string;
  let cookieAdmin: string;

  // Lo que las pruebas se pasan entre sí, como en v1.
  let idCertificacion: number;
  const v1 = generarPdf(['Certificación de pagos', 'flujo v1']);
  const v2 = generarPdf(['Certificación de pagos', 'flujo v2']);
  const palabras = palabrasFicticias(1500, 777);
  // Una clave con texto propio, para comprobar que la auditoría no la guarda (no puede ser «incorrecta»: el detalle dice «clave incorrecta»).
  const CLAVE_ERRONEA = 'zorro-violeta-4821';

  beforeAll(async () => {
    ctx = await crearApp();
    await limpiarTablas(ctx.pool);
    for (const objeto of await ctx.almacen.listar('documentos/')) await ctx.almacen.borrar(objeto.clave);
    await crearUsuario(ctx.db, { usuario: 'admin.demo', rol: 'administrador' });
    await crearUsuario(ctx.db, { usuario: 'editor.demo', rol: 'editor' });
    await crearUsuario(ctx.db, { usuario: 'consulta.demo', rol: 'consulta' });
    await sembrarCcdDemo(ctx.db);
    const { rows } = await ctx.pool.query(`select id from series_ccd where codigo = '100.1'`);
    subserie = rows[0].id;
    cookieEditor = await ingresar(ctx.app, 'editor.demo');
    cookieConsulta = await ingresar(ctx.app, 'consulta.demo');
    cookieAdmin = await ingresar(ctx.app, 'admin.demo');
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  const http = () => request(ctx.app.getHttpServer());

  function cargar(
    cookie: string,
    archivo: Buffer | null,
    campos: Record<string, string | undefined> = {},
    nombre = 'documento.pdf',
  ) {
    const datos: Record<string, string | undefined> = {
      titulo: 'Documento de prueba',
      expediente: 'EXP-100',
      serieId: String(subserie),
      fechaDocumento: '2026-03-02',
      ...campos,
    };
    let peticion = http().post('/documentos').set('Cookie', cookie);
    for (const [campo, valor] of Object.entries(datos)) {
      if (valor !== undefined) peticion = peticion.field(campo, valor);
    }
    if (archivo) peticion = peticion.attach('archivo', archivo, { filename: nombre, contentType: 'application/pdf' });
    return peticion;
  }

  const total = async () => (await http().get('/documentos').set('Cookie', cookieAdmin).expect(200)).body.total as number;

  it('Prueba v1 · 1. rechaza credenciales incorrectas y exige sesión', async () => {
    const mala = await http().post('/auth/login').send({ usuario: 'editor.demo', clave: CLAVE_ERRONEA });
    expect(mala.status).toBe(401);
    expect(mala.headers['set-cookie']).toBeUndefined();
    // Un usuario que no existe responde igual: no revela cuáles existen.
    const inexistente = await http().post('/auth/login').send({ usuario: 'nadie', clave: CLAVE_ERRONEA });
    expect(inexistente.status).toBe(401);
    expect(inexistente.body.message).toBe(mala.body.message);

    // Sin sesión no se ve nada (en v1 era una redirección a /login; aquí, 401).
    await http().get('/documentos').expect(401);
    await http().get('/auth/yo').expect(401);
    await http().get('/auditoria').expect(401);
    // Con credenciales buenas sí entra.
    const buena = await http().post('/auth/login').send({ usuario: 'editor.demo', clave: CLAVE_DE_PRUEBA });
    expect(buena.status).toBe(200);
    expect(buena.headers['set-cookie']?.[0]).toContain('faro_sesion=');
  });

  it('Prueba v1 · 2. flujo de carga, búsqueda sin tildes, versión e historial', async () => {
    const carga = await cargar(cookieEditor, v1, { titulo: 'Certificación de pagos' }, 'certificación.pdf').expect(201);
    idCertificacion = carga.body.documento.id;

    // La búsqueda sin tildes lo encuentra.
    const busqueda = await http().get('/documentos').query({ q: 'certificacion' }).set('Cookie', cookieEditor).expect(200);
    expect(busqueda.body.items.map((i: { titulo: string }) => i.titulo)).toContain('Certificación de pagos');

    // Una versión nueva con motivo.
    await http()
      .post(`/documentos/${idCertificacion}/versiones`)
      .set('Cookie', cookieEditor)
      .field('motivo', 'Corrige el valor')
      .attach('archivo', v2, { filename: 'certificación v2.pdf', contentType: 'application/pdf' })
      .expect(201);

    // El detalle: versión vigente 2, ambos motivos y las tildes del nombre del archivo.
    const detalle = (await http().get(`/documentos/${idCertificacion}`).set('Cookie', cookieEditor).expect(200)).body;
    expect(detalle.versiones.map((v: { numero: number }) => v.numero)).toEqual([2, 1]);
    expect(detalle.versiones.map((v: { motivo: string }) => v.motivo)).toEqual(['Corrige el valor', 'Carga inicial']);
    expect(detalle.versiones[1].nombreOriginal).toBe('certificación.pdf');
    const listado = (await http().get('/documentos').set('Cookie', cookieEditor)).body;
    expect(listado.items.find((i: { id: number }) => i.id === idCertificacion).versionActual).toBe(2);
  });

  it('Prueba v1 · 3. el rol de consulta lee y descarga, pero no modifica', async () => {
    const antes = await total();
    await cargar(cookieConsulta, generarPdf(['consulta']), { titulo: 'No permitido' }).expect(403);
    await http()
      .post(`/documentos/${idCertificacion}/versiones`)
      .set('Cookie', cookieConsulta)
      .field('motivo', 'x')
      .attach('archivo', generarPdf(['consulta v3']), { filename: 'v3.pdf', contentType: 'application/pdf' })
      .expect(403);
    await http().post(`/documentos/${idCertificacion}/versiones/1/restaurar`).set('Cookie', cookieConsulta).send({}).expect(403);
    await http().get('/auditoria').set('Cookie', cookieConsulta).expect(403);
    expect(await total()).toBe(antes);
    const historial = await http().get(`/documentos/${idCertificacion}/versiones`).set('Cookie', cookieConsulta).expect(200);
    expect(historial.body).toHaveLength(2);

    // Lee y descarga: el archivo baja idéntico al que se cargó.
    const descarga = await http()
      .get(`/documentos/${idCertificacion}/versiones/1/archivo`)
      .set('Cookie', cookieConsulta)
      .buffer(true)
      .parse((res, fin) => {
        const trozos: Buffer[] = [];
        res.on('data', (t: Buffer) => trozos.push(t));
        res.on('end', () => fin(null, Buffer.concat(trozos)));
      })
      .expect(200);
    expect((descarga.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect((descarga.body as Buffer).equals(v1)).toBe(true);
  });

  it('Prueba v1 · 4. detecta un archivo ya digitalizado (idéntico y reescaneo)', async () => {
    const original = await pdfConTexto(palabras, { creado: new Date('2026-03-02T10:00:00Z'), productor: 'Escáner A' });
    await cargar(cookieEditor, original, { titulo: 'Original' }).expect(201);
    const antes = await total();

    // El mismo archivo: 409 y dice dónde está.
    const copia = await cargar(cookieEditor, original, { titulo: 'Copia' }).expect(409);
    expect(copia.body).toMatchObject({ codigo: 'duplicado_exacto', existente: { titulo: 'Original', version: 1 } });
    expect(await total()).toBe(antes);

    // El reescaneo (otros bytes, mismo texto con algún error de OCR): 409 con el candidato, y decide la persona.
    const reescaneo = await pdfConTexto(conErroresDeOcr(palabras, 0.01, 3), {
      creado: new Date('2026-05-20T16:30:00Z'),
      productor: 'Escáner B',
    });
    const aviso = await cargar(cookieEditor, reescaneo, { titulo: 'Reescaneo' }).expect(409);
    expect(aviso.body).toMatchObject({ codigo: 'duplicado_probable', candidatos: [{ titulo: 'Original', version: 1 }] });
    expect(await total()).toBe(antes);
    await cargar(cookieEditor, reescaneo, {
      titulo: 'Reescaneo',
      decision: 'documento_distinto',
      justificacion: 'Es el contrato del segundo lote',
    }).expect(201);
    expect(await total()).toBe(antes + 1);
  });

  it('Prueba v1 · 5. rechaza archivos que no son PDF y datos incompletos', async () => {
    const antes = await total();
    // v1 respondía 400; la API nueva distingue: 415 para un tipo de archivo que no es PDF.
    await cargar(cookieEditor, Buffer.from('esto no es un pdf'), { titulo: 'Falso' }).expect(415);
    // Aunque diga serlo por la extensión y el tipo.
    await cargar(cookieEditor, Buffer.from('<html>nada</html>'), { titulo: 'Falso 2' }, 'falso.pdf').expect(415);
    const sinTitulo = await cargar(cookieEditor, generarPdf(['sin titulo']), { titulo: '' }).expect(400);
    expect(sinTitulo.body.problemas.join(' ')).toContain('titulo');
    await cargar(cookieEditor, generarPdf(['sin expediente']), { expediente: undefined }).expect(400);
    // Un archivo vacío no es un PDF (415); sin archivo adjunto es un dato que falta (400).
    await cargar(cookieEditor, Buffer.alloc(0)).expect(415);
    await cargar(cookieEditor, null).expect(400);
    expect(await total()).toBe(antes);
  });

  it('Prueba v1 · 6. solo el administrador ve la auditoría, con las acciones registradas', async () => {
    await http().get('/auditoria').set('Cookie', cookieEditor).expect(403);
    await http().get('/auditoria').set('Cookie', cookieConsulta).expect(403);

    const { body } = await http().get('/auditoria').query({ tamano: 100 }).set('Cookie', cookieAdmin).expect(200);
    const acciones = new Set((body.items as Evento[]).map((e) => e.accion));
    for (const esperada of [
      'ingreso',
      'ingreso_fallido', // la prueba 1
      'acceso_denegado', // las pruebas 3 y 6
      'carga',
      'version',
      'descarga', // la prueba 3
      'decision_duplicado', // la prueba 4 (en v1 se auditaba cada duplicado detectado)
    ]) {
      expect(acciones, `falta el evento ${esperada}`).toContain(esperada);
    }
    // La auditoría no guarda lo escrito en un ingreso fallido.
    expect(JSON.stringify(body)).not.toContain(CLAVE_ERRONEA);
    // Y no se puede reescribir: ni la API ni la base lo permiten.
    await expect(ctx.pool.query(`update auditoria set accion = 'otra'`)).rejects.toThrow();
    await expect(ctx.pool.query(`delete from auditoria`)).rejects.toThrow();
  });

  it('Prueba v1 · 7. los datos persisten al reiniciar la aplicación', async () => {
    const antes = {
      total: await total(),
      historial: (await http().get(`/documentos/${idCertificacion}/versiones`).set('Cookie', cookieConsulta)).body,
      eventos: (await http().get('/auditoria').query({ tamano: 100 }).set('Cookie', cookieAdmin)).body.total as number,
    };
    expect(antes.total).toBeGreaterThanOrEqual(3);

    // Reinicio de verdad: se cierra la instancia (y su conexión a la base) y se levanta otra
    // contra la misma base de datos y el mismo almacén de archivos.
    await ctx.app.close();
    ctx = await crearApp();

    expect(await total()).toBe(antes.total);
    const historial = (await http().get(`/documentos/${idCertificacion}/versiones`).set('Cookie', cookieConsulta).expect(200)).body;
    expect(historial).toEqual(antes.historial);
    expect((await http().get('/auditoria').query({ tamano: 100 }).set('Cookie', cookieAdmin).expect(200)).body.total).toBe(antes.eventos);

    // La sesión sobrevive al reinicio (las sesiones están en PostgreSQL, no en la memoria del proceso).
    await http().get('/auth/yo').set('Cookie', cookieConsulta).expect(200);
    // Los archivos también: la descarga sigue entregando lo cargado.
    const descarga = await http().get(`/documentos/${idCertificacion}/versiones/1/archivo`).set('Cookie', cookieConsulta).expect(200);
    expect(descarga.status).toBe(200);
    // Y se puede volver a ingresar.
    await ingresar(ctx.app, 'consulta.demo');
  });
});
