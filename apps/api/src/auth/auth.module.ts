import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { RolesGuard } from './roles.guard.js';
import { SesionesRepository } from './sesiones.repository.js';
import { UsuariosRepository } from './usuarios.repository.js';

@Module({
  imports: [AuditoriaModule],
  controllers: [AuthController],
  providers: [
    UsuariosRepository,
    SesionesRepository,
    AuthService,
    // El orden importa: primero se identifica a la persona y después se revisa su rol.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
