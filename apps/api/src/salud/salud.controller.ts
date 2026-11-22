import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { SaludService, type InformeSalud } from './salud.service.js';

@Controller('health')
export class SaludController {
  constructor(@Inject(SaludService) private readonly salud: SaludService) {}

  /** Estado de la API y de la base. Responde 503 si la base no contesta. */
  @Get()
  async estado(@Res({ passthrough: true }) respuesta: Response): Promise<InformeSalud> {
    const informe = await this.salud.verificar();
    if (informe.estado !== 'ok') {
      respuesta.status(503);
    }
    return informe;
  }
}
