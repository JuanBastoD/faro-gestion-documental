import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { OrigenGuard } from './origen.guard.js';

/** Protecciones que valen para toda la API y no pertenecen a un módulo de negocio (ADR-009). */
@Module({
  providers: [{ provide: APP_GUARD, useClass: OrigenGuard }],
})
export class SeguridadModule {}
