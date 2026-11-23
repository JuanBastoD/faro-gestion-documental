import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { CcdModule } from '../ccd/ccd.module.js';
import { DocumentosController } from './documentos.controller.js';
import { DocumentosRepository } from './documentos.repository.js';
import { DocumentosService } from './documentos.service.js';

@Module({
  imports: [CcdModule, AuditoriaModule],
  controllers: [DocumentosController],
  providers: [DocumentosRepository, DocumentosService],
  exports: [DocumentosService, DocumentosRepository],
})
export class DocumentosModule {}
