import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { ENTORNO } from '../config/config.module.js';
import type { Entorno } from '../config/entorno.js';
import { AuthService } from './auth.service.js';
import { COOKIE_SESION, leerCookie, opcionesCookie } from './cookie-sesion.js';
import { leerCambioDeClave } from './datos-clave.js';
import {
  PermitidoConClaveTemporal,
  Publico,
  UsuarioActual,
  type PeticionConUsuario,
} from './decoradores.js';
import { DemasiadosIntentosError } from './limite-ingreso.js';
import type { UsuarioSesion } from './roles.js';

// Los topes evitan que alguien mande cuerpos enormes para hacer trabajar al hash.
const credenciales = z.object({
  usuario: z.string().trim().min(1).max(64),
  clave: z.string().min(1).max(256),
});

/** 429 con `Retry-After`: el mismo para el ingreso y para el cambio de clave, que comparten el límite (ADR-009). */
function limiteAgotado(error: DemasiadosIntentosError, respuesta: Response, que: string): HttpException {
  respuesta.setHeader('Retry-After', String(error.esperaSeg));
  const minutos = Math.ceil(error.esperaSeg / 60);
  return new HttpException(
    {
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      error: 'Too Many Requests',
      codigo: 'demasiados_intentos',
      message: `Demasiados intentos de ${que}. Intenta de nuevo en ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}.`,
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ENTORNO) private readonly entorno: Entorno,
  ) {}

  @Publico()
  @Post('login')
  @HttpCode(200)
  async ingresar(
    @Body() cuerpo: unknown,
    @Req() peticion: PeticionConUsuario,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<{ usuario: UsuarioSesion }> {
    const datos = credenciales.safeParse(cuerpo);
    if (!datos.success) {
      throw new BadRequestException('Se requieren usuario y clave');
    }
    let sesion;
    try {
      // La IP es la que Express ve según CONFIAR_EN_PROXY (ADR-009), no un encabezado que escriba el cliente.
      sesion = await this.auth.ingresar(datos.data.usuario, datos.data.clave, peticion.ip ?? 'desconocida');
    } catch (error) {
      if (error instanceof DemasiadosIntentosError) throw limiteAgotado(error, respuesta, 'ingreso');
      throw error;
    }
    const { token, usuario } = sesion;
    respuesta.cookie(COOKIE_SESION, token, opcionesCookie(this.entorno.NODE_ENV === 'production'));
    return { usuario };
  }

  @PermitidoConClaveTemporal()
  @Post('logout')
  @HttpCode(204)
  async salir(
    @Req() peticion: PeticionConUsuario,
    @UsuarioActual() usuario: UsuarioSesion | undefined,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<void> {
    const token = leerCookie(peticion.headers.cookie, COOKIE_SESION);
    // El AuthGuard ya comprobó que hay sesión; la condición es por los tipos.
    if (token && usuario) {
      await this.auth.cerrarSesion(token, usuario);
    }
    const { maxAge: _maxAge, ...sinDuracion } = opcionesCookie(
      this.entorno.NODE_ENV === 'production',
    );
    respuesta.clearCookie(COOKIE_SESION, sinDuracion);
  }

  /**
   * Cambio de clave propio (ADR-011). Pide la clave actual; cierra las demás sesiones de la persona y deja abierta
   * la actual. Una clave actual incorrecta es 400 `clave_actual_incorrecta` (nunca 401) y cuenta en el límite de
   * intentos de ingreso. Es también la salida de quien tiene una clave temporal.
   */
  @PermitidoConClaveTemporal()
  @Post('clave')
  @HttpCode(204)
  async cambiarClave(
    @Body() cuerpo: unknown,
    @Req() peticion: PeticionConUsuario,
    @UsuarioActual() usuario: UsuarioSesion | undefined,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<void> {
    const datos = leerCambioDeClave(cuerpo);
    const token = leerCookie(peticion.headers.cookie, COOKIE_SESION);
    // El AuthGuard ya comprobó que hay sesión; la comprobación es por los tipos.
    if (!usuario || !token) throw new UnauthorizedException('Se requiere iniciar sesión');
    try {
      await this.auth.cambiarClave(
        usuario,
        token,
        datos.claveActual,
        datos.claveNueva,
        peticion.ip ?? 'desconocida',
      );
    } catch (error) {
      if (error instanceof DemasiadosIntentosError) throw limiteAgotado(error, respuesta, 'cambio de clave');
      throw error;
    }
  }

  @PermitidoConClaveTemporal()
  @Get('yo')
  quienSoy(@UsuarioActual() usuario: UsuarioSesion | undefined): { usuario: UsuarioSesion | null } {
    return { usuario: usuario ?? null };
  }
}
