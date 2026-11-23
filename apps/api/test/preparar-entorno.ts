import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cargarEnvLocal } from '../src/config/cargar-env.js';
import { urlDePruebas } from './url-pruebas.js';

// En local toma DATABASE_URL del .env de la raíz; en CI la variable ya viene definida.
cargarEnvLocal();
// Desde aquí, todo lo que lea DATABASE_URL (la API de las pruebas) usa la base de pruebas.
process.env.DATABASE_URL = urlDePruebas();
// Las pruebas de la API guardan los PDF en una carpeta temporal, nunca en el almacén de desarrollo.
// El adaptador S3 se prueba aparte (test/almacen.e2e-spec.ts) con su propio bucket de pruebas.
process.env.ALMACEN_TIPO = 'disco';
process.env.ALMACEN_RUTA = join(tmpdir(), 'faro-almacen-pruebas');
