const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { enTransaccion, normalizar } = require('./db');

const ahora = () => new Date().toISOString();
const huella = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const esPdf = (buffer) => buffer.subarray(0, 5).toString('latin1') === '%PDF-';

function registrarAuditoria(db, { usuarioId = null, accion, documentoId = null, detalle = null }) {
  db.prepare(
    'INSERT INTO auditoria (usuario_id, accion, documento_id, detalle, creado_en) VALUES (?, ?, ?, ?, ?)'
  ).run(usuarioId, accion, documentoId, detalle, ahora());
}

/** Solo las subseries admiten documentos. */
function listarSeries(db) {
  return db.prepare(`
    SELECT s.id, s.codigo, s.nombre, p.nombre AS padre
    FROM series_ccd s JOIN series_ccd p ON p.id = s.padre_id
    ORDER BY s.codigo
  `).all();
}

function serieValida(db, id) {
  return Boolean(db.prepare('SELECT 1 FROM series_ccd WHERE id = ? AND padre_id IS NOT NULL').get(id));
}

const SELECT_DOCUMENTO = `
  SELECT d.id, d.titulo, d.expediente, d.fecha_documento, d.creado_en,
         s.codigo AS serie_codigo, s.nombre AS serie_nombre, v.numero AS version_actual
  FROM documentos d
  JOIN series_ccd s ON s.id = d.serie_id
  JOIN versiones v ON v.documento_id = d.id
   AND v.numero = (SELECT MAX(numero) FROM versiones WHERE documento_id = d.id)
`;

function buscarDocumentos(db, { texto = '', serieId = null } = {}) {
  const patron = `%${normalizar(texto).replace(/[\\%_]/g, '\\$&')}%`;
  return db.prepare(`${SELECT_DOCUMENTO}
    WHERE (norm(d.titulo) LIKE ?1 ESCAPE '\\'
        OR norm(d.expediente) LIKE ?1 ESCAPE '\\'
        OR norm(s.codigo) LIKE ?1 ESCAPE '\\'
        OR norm(s.nombre) LIKE ?1 ESCAPE '\\')
      AND (?2 IS NULL OR d.serie_id = ?2)
    ORDER BY d.creado_en DESC, d.id DESC
  `).all(patron, serieId);
}

function obtenerDocumento(db, id) {
  return db.prepare(`${SELECT_DOCUMENTO} WHERE d.id = ?`).get(id);
}

function listarVersiones(db, documentoId) {
  return db.prepare(`
    SELECT v.id, v.numero, v.nombre_original, v.sha256, v.tamano, v.motivo, v.creado_en,
           u.nombre AS autor
    FROM versiones v JOIN usuarios u ON u.id = v.autor_id
    WHERE v.documento_id = ?
    ORDER BY v.numero DESC
  `).all(documentoId);
}

function obtenerVersion(db, id) {
  return db.prepare('SELECT * FROM versiones WHERE id = ?').get(id);
}

/** Devuelve dónde está ya cargado un archivo, si existe. */
function buscarDuplicado(db, sha256) {
  return db.prepare(`
    SELECT v.numero, v.creado_en, u.nombre AS autor,
           d.id AS documento_id, d.titulo, d.expediente
    FROM versiones v
    JOIN documentos d ON d.id = v.documento_id
    JOIN usuarios u ON u.id = v.autor_id
    WHERE v.sha256 = ?
  `).get(sha256);
}

function insertarVersion(db, uploadsDir, { documentoId, numero, archivo, motivo, autorId, sha256 }) {
  const nombreArchivo = `${sha256}.pdf`;
  db.prepare(`
    INSERT INTO versiones
      (documento_id, numero, archivo, nombre_original, sha256, tamano, motivo, autor_id, creado_en)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(documentoId, numero, nombreArchivo, archivo.nombre, sha256, archivo.buffer.length, motivo, autorId, ahora());
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.writeFileSync(path.join(uploadsDir, nombreArchivo), archivo.buffer);
}

function crearDocumento(db, uploadsDir, datos, archivo, autorId) {
  const sha256 = huella(archivo.buffer);
  const duplicado = buscarDuplicado(db, sha256);
  if (duplicado) return { duplicado };

  const id = enTransaccion(db, () => {
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO documentos (titulo, expediente, serie_id, fecha_documento, creado_por, creado_en)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(datos.titulo, datos.expediente, datos.serieId, datos.fecha, autorId, ahora());
    const documentoId = Number(lastInsertRowid);
    insertarVersion(db, uploadsDir, {
      documentoId, numero: 1, archivo, motivo: 'Carga inicial', autorId, sha256,
    });
    registrarAuditoria(db, { usuarioId: autorId, accion: 'carga', documentoId, detalle: archivo.nombre });
    return documentoId;
  });
  return { id };
}

function agregarVersion(db, uploadsDir, documentoId, archivo, motivo, autorId) {
  const sha256 = huella(archivo.buffer);
  const duplicado = buscarDuplicado(db, sha256);
  if (duplicado) return { duplicado };

  const numero = enTransaccion(db, () => {
    const { siguiente } = db.prepare(
      'SELECT COALESCE(MAX(numero), 0) + 1 AS siguiente FROM versiones WHERE documento_id = ?'
    ).get(documentoId);
    insertarVersion(db, uploadsDir, { documentoId, numero: siguiente, archivo, motivo, autorId, sha256 });
    registrarAuditoria(db, {
      usuarioId: autorId, accion: 'nueva_version', documentoId, detalle: `v${siguiente}: ${motivo}`,
    });
    return siguiente;
  });
  return { numero };
}

function listarAuditoria(db, limite = 200) {
  return db.prepare(`
    SELECT a.accion, a.detalle, a.creado_en, a.documento_id, u.nombre AS usuario, d.titulo
    FROM auditoria a
    LEFT JOIN usuarios u ON u.id = a.usuario_id
    LEFT JOIN documentos d ON d.id = a.documento_id
    ORDER BY a.id DESC
    LIMIT ?
  `).all(limite);
}

module.exports = {
  agregarVersion,
  buscarDocumentos,
  crearDocumento,
  esPdf,
  listarAuditoria,
  listarSeries,
  listarVersiones,
  obtenerDocumento,
  obtenerVersion,
  registrarAuditoria,
  serieValida,
};
