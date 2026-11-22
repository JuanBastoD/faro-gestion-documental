import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { Roles, UsuarioActual } from '../auth/decoradores.js';
import type { UsuarioSesion } from '../auth/roles.js';
import { IdentificadorPipe } from '../documentos/paginacion.js';
import { leerCambioDeUsuario, leerNuevoUsuario } from './datos-usuario.js';
import type { UsuarioAdministrado } from './usuarios-admin.repository.js';
import { UsuariosService } from './usuarios.service.js';

/** Administración de usuarios: solo el administrador. */
@Roles('administrador')
@Controller('usuarios')
export class UsuariosController {
  constructor(@Inject(UsuariosService) private readonly usuarios: UsuariosService) {}

  /** Todos los usuarios, activos e inactivos, por orden de creación. Son unas decenas: no se pagina. */
  @Get()
  listar(): Promise<UsuarioAdministrado[]> {
    return this.usuarios.listar();
  }

  @Post()
  @HttpCode(201)
  crear(
    @Body() cuerpo: unknown,
    @UsuarioActual() actor: UsuarioSesion | undefined,
  ): Promise<UsuarioAdministrado> {
    // El AuthGuard ya comprobó que hay sesión; la comprobación es por los tipos.
    return this.usuarios.crear(leerNuevoUsuario(cuerpo), this.exigir(actor));
  }

  /** Cambia el rol o la actividad. Desactivar cierra las sesiones del usuario. */
  @Patch(':id')
  cambiar(
    @Param('id', IdentificadorPipe) id: number,
    @Body() cuerpo: unknown,
    @UsuarioActual() actor: UsuarioSesion | undefined,
  ): Promise<UsuarioAdministrado> {
    return this.usuarios.cambiar(id, leerCambioDeUsuario(cuerpo), this.exigir(actor));
  }

  private exigir(actor: UsuarioSesion | undefined): UsuarioSesion {
    if (!actor) throw new Error('Se llegó al controlador sin sesión');
    return actor;
  }
}
