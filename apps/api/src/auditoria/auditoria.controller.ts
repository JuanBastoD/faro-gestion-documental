import { BadRequestException, Controller, Get, Inject, Query } from '@nestjs/common';
import { Roles } from '../auth/decoradores.js';
import { AuditoriaService } from './auditoria.service.js';
import type { PaginaDeEventos } from './auditoria.repository.js';
import { FiltrosInvalidosError, leerFiltros } from './filtros-auditoria.js';

/**
 * Solo lectura y solo para el administrador. A propósito no hay rutas para crear,
 * editar ni borrar eventos: los eventos los generan las demás funciones del sistema.
 */
@Controller('auditoria')
@Roles('administrador')
export class AuditoriaController {
  constructor(@Inject(AuditoriaService) private readonly auditoria: AuditoriaService) {}

  @Get()
  consultar(@Query() consulta: unknown): Promise<PaginaDeEventos> {
    try {
      return this.auditoria.consultar(leerFiltros(consulta));
    } catch (error) {
      if (error instanceof FiltrosInvalidosError) {
        throw new BadRequestException({ message: error.message, problemas: error.problemas });
      }
      throw error;
    }
  }
}
