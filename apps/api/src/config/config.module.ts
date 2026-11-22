import { Global, Module } from '@nestjs/common';
import { validarEntorno } from './entorno.js';

/** Token para inyectar el entorno ya validado: @Inject(ENTORNO). */
export const ENTORNO = Symbol('ENTORNO');

@Global()
@Module({
  providers: [{ provide: ENTORNO, useFactory: () => validarEntorno(process.env) }],
  exports: [ENTORNO],
})
export class ConfigModule {}
