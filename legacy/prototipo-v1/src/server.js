const path = require('node:path');
const { crearApp } = require('./app');
const { abrirDb } = require('./db');
const { RUTAS, sembrarSiVacia } = require('../seed/sembrar');

const PUERTO = Number(process.env.PORT) || 3000;

const db = abrirDb(RUTAS.db);
sembrarSiVacia(db);

// Solo escucha en el propio equipo: es un prototipo con usuarios de demostración.
crearApp({ db, uploadsDir: RUTAS.uploads }).listen(PUERTO, '127.0.0.1', () => {
  console.log(`Prototipo disponible en http://localhost:${PUERTO}`);
  console.log(`PDF para la demo: ${path.resolve(RUTAS.demo)}`);
});
