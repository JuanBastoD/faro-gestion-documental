import { Controller, Get, Inject } from '@nestjs/common';
import { SeriesService, type Serie } from './series.service.js';

@Controller('series')
export class SeriesController {
  constructor(@Inject(SeriesService) private readonly series: SeriesService) {}

  /** El cuadro de clasificación como árbol. Lo ve cualquier persona con sesión. */
  @Get()
  arbol(): Promise<Serie[]> {
    return this.series.arbol();
  }
}
