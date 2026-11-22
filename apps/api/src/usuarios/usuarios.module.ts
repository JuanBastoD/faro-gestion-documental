import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { UsuariosAdminRepository } from './usuarios-admin.repository.js';
import { UsuariosController } from './usuarios.controller.js';
import { UsuariosService } from './usuarios.service.js';

@Module({
  imports: [AuditoriaModule],
  controllers: [UsuariosController],
  providers: [UsuariosAdminRepository, UsuariosService],
})
export class UsuariosModule {}
