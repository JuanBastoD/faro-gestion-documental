import { cargarEnvLocal } from '../src/config/cargar-env.js';

// En local toma DATABASE_URL del .env de la raíz; en CI la variable ya viene definida.
cargarEnvLocal();
