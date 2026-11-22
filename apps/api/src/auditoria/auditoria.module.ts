import { Module } from '@nestjs/common';
import { AuditoriaRepository } from './auditoria.repository.js';
import { AuditoriaService } from './auditoria.service.js';

@Module({
  providers: [AuditoriaRepository, AuditoriaService],
  exports: [AuditoriaService],
})
export class AuditoriaModule {}
