import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Roles, UsuarioActual } from '../auth/decoradores.js';
import type { UsuarioSesion } from '../auth/roles.js';
import { TAMANO_MAXIMO_BYTES, decodificarNombre } from './archivo-pdf.js';
import { DatosInvalidosError } from './datos-carga.js';
import type { VersionDetalle } from './documentos.repository.js';
import { IdentificadorPipe } from './paginacion.js';
import { VersionesService } from './versiones.service.js';

interface ArchivoSubido {
  originalname: string;
  buffer: Buffer;
}

function exigirUsuario(usuario: UsuarioSesion | undefined): UsuarioSesion {
  if (!usuario) throw new UnauthorizedException('Se requiere iniciar sesión');
  return usuario;
}

/** Datos inválidos del formulario → 400 con la lista de problemas. */
async function comoSolicitudInvalida<T>(trabajo: () => Promise<T>): Promise<T> {
  try {
    return await trabajo();
  } catch (error) {
    if (error instanceof DatosInvalidosError) {
      throw new BadRequestException({ message: error.message, problemas: error.problemas });
    }
    throw error;
  }
}

@Controller('documentos/:id/versiones')
export class VersionesController {
  constructor(@Inject(VersionesService) private readonly versiones: VersionesService) {}

  /** Historial del documento, la versión más reciente primero. */
  @Get()
  listar(@Param('id', IdentificadorPipe) id: number): Promise<VersionDetalle[]> {
    return this.versiones.listar(id);
  }

  /**
   * Sube una versión nueva. Formulario multipart: el PDF en `archivo` y `motivo` (obligatorio).
   * Responde 409 si el contenido ya está en una versión de este documento.
   */
  @Post()
  @Roles('administrador', 'editor')
  @UseInterceptors(
    FileInterceptor('archivo', {
      limits: { fileSize: TAMANO_MAXIMO_BYTES, files: 1, fields: 5, fieldSize: 4096 },
    }),
  )
  agregar(
    @Param('id', IdentificadorPipe) id: number,
    @Body() cuerpo: unknown,
    @UploadedFile() archivo: ArchivoSubido | undefined,
    @UsuarioActual() usuario: UsuarioSesion | undefined,
  ): Promise<VersionDetalle> {
    return comoSolicitudInvalida(() =>
      this.versiones.agregar(
        id,
        cuerpo,
        archivo && { nombre: decodificarNombre(archivo.originalname), datos: archivo.buffer },
        exigirUsuario(usuario),
      ),
    );
  }

  /**
   * Restaura una versión anterior creando una versión nueva con su contenido.
   * `motivo` es opcional (por defecto "Restaura la versión n").
   */
  @Post(':numero/restaurar')
  @HttpCode(201)
  @Roles('administrador', 'editor')
  restaurar(
    @Param('id', IdentificadorPipe) id: number,
    @Param('numero', IdentificadorPipe) numero: number,
    @Body() cuerpo: unknown,
    @UsuarioActual() usuario: UsuarioSesion | undefined,
  ): Promise<VersionDetalle> {
    return comoSolicitudInvalida(() =>
      this.versiones.restaurar(id, numero, cuerpo, exigirUsuario(usuario)),
    );
  }
}
