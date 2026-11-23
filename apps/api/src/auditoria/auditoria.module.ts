import { Module } from '@nestjs/common';
import { AuditoriaController } from './auditoria.controller.js';
import { AuditoriaRepository } from './auditoria.repository.js';
import { AuditoriaService } from './auditoria.service.js';

@Module({
  controllers: [AuditoriaController],
  providers: [AuditoriaRepository, AuditoriaService],
  exports: [AuditoriaService],
})
export class AuditoriaModule {}
