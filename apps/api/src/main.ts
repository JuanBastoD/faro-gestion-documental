import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { cargarEnvLocal } from './config/cargar-env.js';
import { EntornoInvalidoError, validarEntorno } from './config/entorno.js';
import { configurarSeguridad } from './seguridad/configurar.js';

async function iniciar(): Promise<void> {
  cargarEnvLocal();

  // Se valida antes de crear la aplicación para dar un mensaje claro y salir con error.
  let entorno;
  try {
    entorno = validarEntorno(process.env);
  } catch (error) {
    if (error instanceof EntornoInvalidoError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  // abortOnError: false hace que un fallo al arrancar rechace la promesa en vez de abortar el proceso.
  const app = await NestFactory.create(AppModule, { abortOnError: false });
  configurarSeguridad(app, entorno);
  app.enableShutdownHooks();
  await app.listen(entorno.PORT, entorno.HOST);
}

await iniciar();
