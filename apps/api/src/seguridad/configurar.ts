import type { INestApplication } from '@nestjs/common';
import helmet from 'helmet';
import type { Entorno } from '../config/entorno.js';

/**
 * Lo que no se puede declarar en un módulo de Nest porque es del servidor Express: cabeceras de seguridad y
 * cuántos proxies hay delante. Lo usan `main.ts` y las pruebas, para que se pruebe lo mismo que corre.
 *
 * - `helmet()` con sus valores por defecto: `Content-Security-Policy` restrictiva, `X-Content-Type-Options: nosniff`,
 *   `Strict-Transport-Security` (los navegadores la ignoran por HTTP), sin `X-Powered-By`, etc. La API también
 *   sirve la interfaz web bajo `/app/`: [CONFIRMADO en #23] con la interfaz real, en Chromium, esta política no
 *   bloquea nada (la interfaz no usa scripts ni estilos en línea ni orígenes externos), así que no se cambió.
 *   Ver el ADR-012; `apps/web/src/indice.test.ts` protege esa compatibilidad.
 * - `trust proxy`: de cuántos saltos se fía Express para leer la IP del cliente en `X-Forwarded-For`. Con 0
 *   ignora ese encabezado. Determina la IP del límite de intentos de ingreso (ADR-009).
 */
export function configurarSeguridad(
  app: INestApplication,
  entorno: Pick<Entorno, 'CONFIAR_EN_PROXY'>,
): void {
  app.use(helmet());
  const express = app.getHttpAdapter().getInstance() as { set(clave: string, valor: unknown): void };
  express.set('trust proxy', entorno.CONFIAR_EN_PROXY);
}
