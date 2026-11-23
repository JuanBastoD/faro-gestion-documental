import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { CcdModule } from '../ccd/ccd.module.js';
import { DocumentosController } from './documentos.controller.js';
import { DocumentosRepository } from './documentos.repository.js';
import { DocumentosService } from './documentos.service.js';
import { VersionesController } from './versiones.controller.js';
import { VersionesService } from './versiones.service.js';

@Module({
  imports: [CcdModule, AuditoriaModule],
  controllers: [DocumentosController, VersionesController],
  providers: [DocumentosRepository, DocumentosService, VersionesService],
  exports: [DocumentosService, DocumentosRepository],
})
export class DocumentosModule {}
