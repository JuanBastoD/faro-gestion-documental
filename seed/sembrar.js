const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const { crearDocumento } = require('../src/documentos');

const RAIZ = path.join(__dirname, '..');
const RUTAS = {
  datos: path.join(RAIZ, 'data'),
  db: path.join(RAIZ, 'data', 'sgd.sqlite'),
  uploads: path.join(RAIZ, 'data', 'uploads'),
  demo: path.join(RAIZ, 'demo-pdfs'),
};

const CLAVE_DEMO = 'Demo2026!';

const USUARIOS = [
  ['admin.demo', 'Administrador Demo', 'administrador'],
  ['editor.demo', 'Editor Demo', 'editor'],
  ['consulta.demo', 'Consulta Demo', 'consulta'],
];

// [SUPUESTO] CCD de ejemplo. No es un instrumento aprobado por la entidad.
const CCD = [
  ['100', 'Gestión contractual', [['100.1', 'Contratos de obra'], ['100.2', 'Interventoría']]],
  ['200', 'Gestión jurídica', [['200.1', 'Conceptos jurídicos']]],
  ['300', 'Gestión financiera', [['300.1', 'Certificados de disponibilidad']]],
  ['400', 'Gestión administrativa', [['400.1', 'Actas de comité']]],
];

/** Crea un PDF de una página, suficiente para la demostración. */
function generarPdf(lineas) {
  const escapar = (texto) => texto.replace(/[\\()]/g, '\\$&');
  const contenido = `BT /F1 13 Tf 60 740 Td 20 TL\n${
    lineas.map((linea) => `(${escapar(linea)}) Tj T*`).join('\n')
  }\nET`;
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(contenido, 'latin1')} >>\nstream\n${contenido}\nendstream`,
  ];

  let pdf = '%PDF-1.4\n';
  const posiciones = objetos.map((objeto, indice) => {
    const posicion = Buffer.byteLength(pdf, 'latin1');
    pdf += `${indice + 1} 0 obj\n${objeto}\nendobj\n`;
    return posicion;
  });
  const inicioXref = Buffer.byteLength(pdf, 'latin1');
  const entradas = posiciones.map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n${entradas}`;
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

const AVISO = 'DOCUMENTO FICTICIO PARA DEMOSTRACIÓN';
const pdfDemo = (...lineas) => generarPdf([AVISO, '', ...lineas]);

const ACTA_INICIO = pdfDemo('Acta de inicio', 'Contrato de obra DEMO-OBRA-001-2026', 'Versión 1');

const PRECARGADOS = [
  {
    titulo: 'Acta de inicio del contrato de obra', expediente: 'DEMO-OBRA-001-2026',
    serie: '100.1', fecha: '2026-03-02', nombre: 'acta-inicio.pdf', pdf: ACTA_INICIO,
  },
  {
    titulo: 'Informe de interventoría N.° 1', expediente: 'DEMO-OBRA-001-2026',
    serie: '100.2', fecha: '2026-04-15', nombre: 'informe-interventoria-1.pdf',
    pdf: pdfDemo('Informe de interventoría N.° 1', 'Contrato de obra DEMO-OBRA-001-2026'),
  },
  {
    titulo: 'Concepto jurídico sobre adición contractual', expediente: 'DEMO-JUR-014-2026',
    serie: '200.1', fecha: '2026-06-20', nombre: 'concepto-juridico.pdf',
    pdf: pdfDemo('Concepto jurídico sobre adición contractual'),
  },
];

const ARCHIVOS_DEMO = {
  '1-ya-digitalizado.pdf': ACTA_INICIO,
  '2-documento-nuevo.pdf': pdfDemo('Certificado de disponibilidad', 'Expediente DEMO-CDP-031-2026'),
  '3-nueva-version-acta.pdf': pdfDemo(
    'Acta de inicio', 'Contrato de obra DEMO-OBRA-001-2026', 'Versión 2: corrige la fecha de inicio'
  ),
};

function sembrarSiVacia(db, { uploadsDir = RUTAS.uploads, demoDir = RUTAS.demo } = {}) {
  if (db.prepare('SELECT COUNT(*) AS total FROM usuarios').get().total > 0) return;

  const hash = bcrypt.hashSync(CLAVE_DEMO, 10);
  const insertarUsuario = db.prepare('INSERT INTO usuarios (usuario, nombre, rol, clave_hash) VALUES (?, ?, ?, ?)');
  const ids = Object.fromEntries(USUARIOS.map(([usuario, nombre, rol]) => (
    [usuario, Number(insertarUsuario.run(usuario, nombre, rol, hash).lastInsertRowid)]
  )));

  const insertarSerie = db.prepare('INSERT INTO series_ccd (codigo, nombre, padre_id) VALUES (?, ?, ?)');
  const series = {};
  for (const [codigo, nombre, subseries] of CCD) {
    const padreId = Number(insertarSerie.run(codigo, nombre, null).lastInsertRowid);
    for (const [codigoSub, nombreSub] of subseries) {
      series[codigoSub] = Number(insertarSerie.run(codigoSub, nombreSub, padreId).lastInsertRowid);
    }
  }

  for (const { titulo, expediente, serie, fecha, nombre, pdf } of PRECARGADOS) {
    crearDocumento(
      db, uploadsDir, { titulo, expediente, fecha, serieId: series[serie] },
      { nombre, buffer: pdf }, ids['editor.demo']
    );
  }

  fs.mkdirSync(demoDir, { recursive: true });
  for (const [nombre, contenido] of Object.entries(ARCHIVOS_DEMO)) {
    fs.writeFileSync(path.join(demoDir, nombre), contenido);
  }
}

module.exports = { CLAVE_DEMO, RUTAS, generarPdf, sembrarSiVacia };
