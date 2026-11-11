const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ESQUEMA = path.join(__dirname, '..', 'db', 'schema.sql');

/** Minúsculas y sin tildes, para que "contratacion" encuentre "Contratación". */
function normalizar(texto) {
  if (texto === null || texto === undefined) return '';
  return String(texto).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function abrirDb(ruta) {
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  const db = new DatabaseSync(ruta);
  db.exec(fs.readFileSync(ESQUEMA, 'utf8'));
  db.function('norm', { deterministic: true }, normalizar);
  return db;
}

function enTransaccion(db, trabajo) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const resultado = trabajo();
    db.exec('COMMIT');
    return resultado;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

module.exports = { abrirDb, enTransaccion, normalizar };
