import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { FiltroDeExcepciones } from './filtro-excepciones.js';
import { OrigenGuard } from './origen.guard.js';

/**
 * Protecciones que valen para toda la API y no pertenecen a un módulo de negocio (ADR-009).
 *
 * - `OrigenGuard`: rechaza las peticiones que modifican datos y vienen de otro sitio.
 * - `FiltroDeExcepciones`: lo que se registra de un error inesperado no lleva los parámetros de la consulta que
 *   falló (hashes de clave, por ejemplo); la respuesta no cambia.
 */
@Module({
  providers: [
    { provide: APP_GUARD, useClass: OrigenGuard },
    { provide: APP_FILTER, useClass: FiltroDeExcepciones },
  ],
})
export class SeguridadModule {}
