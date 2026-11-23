import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as esquema from '../../base-datos/esquema.js';
import { cargarEnvLocal } from '../../config/cargar-env.js';
import { EntornoInvalidoError, validarEntorno } from '../../config/entorno.js';
import { AYUDA, SALIDA, ejecutarImportacion, prepararImportacion, textoDeArchivoInvalido } from './comando.js';

/**
 * Importa el cuadro de clasificación desde un CSV (#19, ADR-010). Es un comando y no un endpoint a propósito:
 * el cuadro lo valida la entidad una vez y no lo edita cualquier usuario con sesión.
 *
 *   npm run ccd:importar -w apps/api -- docs/ejemplos/cuadro-ejemplo.csv                       (solo muestra)
 *   npm run ccd:importar -w apps/api -- docs/ejemplos/cuadro-ejemplo.csv --aplicar             (escribe)
 *   node apps/api/dist/ccd/importar/importar-cli.js /datos/cuadro.csv --aplicar                (en la imagen)
 *
 * Sin `--aplicar` no cambia nada. Ver `AYUDA` para las opciones y los códigos de salida.
 */
async function ejecutar(): Promise<void> {
  cargarEnvLocal();

  const preparacion = prepararImportacion(process.argv.slice(2), process.env.INIT_CWD ?? process.cwd());
  switch (preparacion.tipo) {
    case 'ayuda':
      console.log(AYUDA);
      return;
    case 'uso':
      console.error(`${preparacion.mensaje}\n\n${AYUDA}`);
      process.exitCode = SALIDA.USO;
      return;
    case 'invalido':
      for (const aviso of preparacion.avisos) console.error(`Aviso: ${aviso}`);
      console.error(textoDeArchivoInvalido(preparacion.archivo, preparacion.errores));
      process.exitCode = SALIDA.RECHAZADO;
      return;
    case 'listo':
      break;
  }

  let entorno;
  try {
    entorno = validarEntorno(process.env);
  } catch (error) {
    if (error instanceof EntornoInvalidoError) {
      console.error(error.message);
      process.exitCode = SALIDA.RECHAZADO;
      return;
    }
    throw error;
  }

  for (const aviso of preparacion.avisos) console.error(`Aviso: ${aviso}`);
  const pool = new pg.Pool({ connectionString: entorno.DATABASE_URL, max: 2 });
  try {
    const db = drizzle(pool, { schema: esquema });
    process.exitCode = await ejecutarImportacion(db, preparacion, {
      info: (texto) => console.log(texto),
      error: (texto) => console.error(texto),
    });
  } finally {
    await pool.end();
  }
}

await ejecutar();
