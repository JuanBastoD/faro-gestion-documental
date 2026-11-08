// Borra únicamente los datos de demostración del prototipo y los vuelve a crear.
const fs = require('node:fs');
const { abrirDb } = require('../src/db');
const { RUTAS, sembrarSiVacia } = require('./sembrar');

fs.rmSync(RUTAS.datos, { recursive: true, force: true });
const db = abrirDb(RUTAS.db);
sembrarSiVacia(db);
db.close();
console.log('Datos de demostración reiniciados.');
