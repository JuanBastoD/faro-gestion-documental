import { cargarEnvLocal } from '../src/config/cargar-env.js';
import { urlDePruebas } from './url-pruebas.js';

// En local toma DATABASE_URL del .env de la raíz; en CI la variable ya viene definida.
cargarEnvLocal();
// Desde aquí, todo lo que lea DATABASE_URL (la API de las pruebas) usa la base de pruebas.
process.env.DATABASE_URL = urlDePruebas();
