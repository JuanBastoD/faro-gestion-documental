import { Module } from '@nestjs/common';
import { BaseDatosModule } from './base-datos/base-datos.module.js';
import { ConfigModule } from './config/config.module.js';
import { SaludModule } from './salud/salud.module.js';

@Module({
  imports: [ConfigModule, BaseDatosModule, SaludModule],
})
export class AppModule {}
