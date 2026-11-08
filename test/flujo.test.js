const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');
const { crearApp } = require('../src/app');
const { abrirDb } = require('../src/db');
const { CLAVE_DEMO, generarPdf, sembrarSiVacia } = require('../seed/sembrar');

let carpeta;
let dbRuta;
let db;
let servidor;
let base;

const uploadsDir = () => path.join(carpeta, 'uploads');

function levantar(baseDatos) {
  return new Promise((resolve) => {
    const instancia = crearApp({ db: baseDatos, uploadsDir: uploadsDir() }).listen(0, '127.0.0.1', () => {
      resolve({ instancia, url: `http://127.0.0.1:${instancia.address().port}` });
    });
  });
}

function cerrar(instancia) {
  return new Promise((resolve) => {
    instancia.close(resolve);
    instancia.closeAllConnections();
  });
}

before(async () => {
  carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'sgd-prueba-'));
  dbRuta = path.join(carpeta, 'sgd.sqlite');
  db = abrirDb(dbRuta);
  sembrarSiVacia(db, { uploadsDir: uploadsDir(), demoDir: path.join(carpeta, 'demo') });
  ({ instancia: servidor, url: base } = await levantar(db));
});

after(async () => {
  await cerrar(servidor);
  db.close();
  fs.rmSync(carpeta, { recursive: true, force: true });
});

async function ingresar(usuario, clave = CLAVE_DEMO, url = base) {
  const res = await fetch(`${url}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ usuario, clave }),
  });
  return { status: res.status, cookie: res.headers.get('set-cookie')?.split(';')[0] };
}

const pedir = (ruta, cookie, opciones = {}, url = base) => fetch(`${url}${ruta}`, {
  redirect: 'manual',
  ...opciones,
  headers: { ...opciones.headers, cookie },
});

function formulario(campos, contenido, nombre = 'documento.pdf') {
  const datos = new FormData();
  Object.entries(campos).forEach(([clave, valor]) => datos.append(clave, valor));
  datos.append('archivo', new Blob([contenido], { type: 'application/pdf' }), nombre);
  return datos;
}

const serieId = () => db.prepare("SELECT id FROM series_ccd WHERE codigo = '300.1'").get().id;
const camposDocumento = (titulo) => ({
  titulo, expediente: 'PRUEBA-001', serie: serieId(), fecha: '2026-11-08',
});
const idDesde = (res) => Number(res.headers.get('location').split('/').pop());

test('rechaza credenciales incorrectas y exige sesión', async () => {
  assert.equal((await ingresar('editor.demo', 'incorrecta')).status, 401);
  const res = await fetch(`${base}/`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/login');
});

test('flujo de carga, búsqueda sin tildes, versión e historial', async () => {
  const { cookie } = await ingresar('editor.demo');

  const carga = await pedir('/documentos', cookie, {
    method: 'POST',
    body: formulario(camposDocumento('Certificación de pagos'), generarPdf(['flujo v1']), 'certificación.pdf'),
  });
  assert.equal(carga.status, 302);
  const id = idDesde(carga);

  const busqueda = await (await pedir('/?q=certificacion', cookie)).text();
  assert.match(busqueda, /Certificación de pagos/);

  const version = await pedir(`/documentos/${id}/versiones`, cookie, {
    method: 'POST',
    body: formulario({ motivo: 'Corrige el valor' }, generarPdf(['flujo v2'])),
  });
  assert.equal(version.status, 302);

  const detalle = await (await pedir(`/documentos/${id}`, cookie)).text();
  assert.match(detalle, /Versión vigente<\/dt><dd>v2/);
  assert.match(detalle, /Corrige el valor/);
  assert.match(detalle, /Carga inicial/);
  assert.match(detalle, /certificación\.pdf/, 'conserva las tildes del nombre del archivo');
});

test('el rol de consulta lee y descarga, pero no modifica', async () => {
  const { cookie } = await ingresar('consulta.demo');
  const carga = await pedir('/documentos', cookie, {
    method: 'POST', body: formulario(camposDocumento('No permitido'), generarPdf(['consulta'])),
  });
  assert.equal(carga.status, 403);
  const version = await pedir('/documentos/1/versiones', cookie, {
    method: 'POST', body: formulario({ motivo: 'x' }, generarPdf(['consulta v2'])),
  });
  assert.equal(version.status, 403);
  assert.equal((await pedir('/auditoria', cookie)).status, 403);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM documentos WHERE titulo = 'No permitido'").get().n, 0);

  const descarga = await pedir('/versiones/1/archivo', cookie);
  assert.equal(descarga.status, 200);
  assert.equal(Buffer.from(await descarga.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
});

test('detecta un archivo ya digitalizado', async () => {
  const { cookie } = await ingresar('editor.demo');
  const contenido = generarPdf(['duplicado']);
  const primera = await pedir('/documentos', cookie, {
    method: 'POST', body: formulario(camposDocumento('Original'), contenido),
  });
  assert.equal(primera.status, 302);
  const antes = db.prepare('SELECT COUNT(*) AS n FROM documentos').get().n;

  const segunda = await pedir('/documentos', cookie, {
    method: 'POST', body: formulario(camposDocumento('Copia'), contenido),
  });
  assert.equal(segunda.status, 409);
  assert.match(await segunda.text(), /ya está digitalizado/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM documentos').get().n, antes);
});

test('rechaza archivos que no son PDF y datos incompletos', async () => {
  const { cookie } = await ingresar('editor.demo');
  const noPdf = await pedir('/documentos', cookie, {
    method: 'POST', body: formulario(camposDocumento('Falso'), 'esto no es un pdf'),
  });
  assert.equal(noPdf.status, 400);
  const sinTitulo = await pedir('/documentos', cookie, {
    method: 'POST', body: formulario(camposDocumento(''), generarPdf(['sin titulo'])),
  });
  assert.equal(sinTitulo.status, 400);
});

test('solo el administrador ve la auditoría, con las acciones registradas', async () => {
  const { cookie } = await ingresar('admin.demo');
  const res = await pedir('/auditoria', cookie);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /acceso denegado/);
  assert.match(html, /duplicado detectado/);
  assert.match(html, /nueva version/);
});

test('los datos persisten al reiniciar la aplicación', async () => {
  const total = db.prepare('SELECT COUNT(*) AS n FROM documentos').get().n;
  await cerrar(servidor);
  db.close();

  db = abrirDb(dbRuta);
  ({ instancia: servidor, url: base } = await levantar(db));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM documentos').get().n, total);

  const { cookie } = await ingresar('consulta.demo');
  assert.equal((await pedir('/versiones/1/archivo', cookie)).status, 200);
});
