import { Module } from '@nestjs/common';
import { AlmacenModule } from './almacen/almacen.module.js';
import { AuditoriaModule } from './auditoria/auditoria.module.js';
import { AuthModule } from './auth/auth.module.js';
import { BaseDatosModule } from './base-datos/base-datos.module.js';
import { CcdModule } from './ccd/ccd.module.js';
import { ConfigModule } from './config/config.module.js';
import { DocumentosModule } from './documentos/documentos.module.js';
import { SaludModule } from './salud/salud.module.js';
import { SeguridadModule } from './seguridad/seguridad.module.js';
import { UsuariosModule } from './usuarios/usuarios.module.js';

@Module({
  imports: [
    ConfigModule,
    BaseDatosModule,
    AlmacenModule,
    AuditoriaModule,
    SeguridadModule,
    AuthModule,
    CcdModule,
    DocumentosModule,
    UsuariosModule,
    SaludModule,
  ],
})
export class AppModule {}
