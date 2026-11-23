import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Publico } from '../auth/decoradores.js';
import { SaludService, type InformeSalud } from './salud.service.js';

@Controller('health')
export class SaludController {
  constructor(@Inject(SaludService) private readonly salud: SaludService) {}

  /** Estado de la API y de la base. Público: lo consultan el balanceador y las alertas. */
  @Publico()
  @Get()
  async estado(@Res({ passthrough: true }) respuesta: Response): Promise<InformeSalud> {
    const informe = await this.salud.verificar();
    if (informe.estado !== 'ok') {
      respuesta.status(503);
    }
    return informe;
  }
}
