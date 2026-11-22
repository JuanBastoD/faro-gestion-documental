import { Module } from '@nestjs/common';
import { AuditoriaModule } from './auditoria/auditoria.module.js';
import { AuthModule } from './auth/auth.module.js';
import { BaseDatosModule } from './base-datos/base-datos.module.js';
import { ConfigModule } from './config/config.module.js';
import { SaludModule } from './salud/salud.module.js';

@Module({
  imports: [ConfigModule, BaseDatosModule, AuditoriaModule, AuthModule, SaludModule],
})
export class AppModule {}
