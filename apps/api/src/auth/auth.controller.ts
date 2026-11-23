import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { ENTORNO } from '../config/config.module.js';
import type { Entorno } from '../config/entorno.js';
import { AuthService } from './auth.service.js';
import { COOKIE_SESION, leerCookie, opcionesCookie } from './cookie-sesion.js';
import { Publico, UsuarioActual, type PeticionConUsuario } from './decoradores.js';
import type { UsuarioSesion } from './roles.js';

// Los topes evitan que alguien mande cuerpos enormes para hacer trabajar al hash.
const credenciales = z.object({
  usuario: z.string().trim().min(1).max(64),
  clave: z.string().min(1).max(256),
});

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
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<{ usuario: UsuarioSesion }> {
    const datos = credenciales.safeParse(cuerpo);
    if (!datos.success) {
      throw new BadRequestException('Se requieren usuario y clave');
    }
    const { token, usuario } = await this.auth.ingresar(datos.data.usuario, datos.data.clave);
    respuesta.cookie(COOKIE_SESION, token, opcionesCookie(this.entorno.NODE_ENV === 'production'));
    return { usuario };
  }

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

  @Get('yo')
  quienSoy(@UsuarioActual() usuario: UsuarioSesion | undefined): { usuario: UsuarioSesion | null } {
    return { usuario: usuario ?? null };
  }
}
