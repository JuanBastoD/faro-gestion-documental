import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  StreamableFile,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Roles, UsuarioActual } from '../auth/decoradores.js';
import type { UsuarioSesion } from '../auth/roles.js';
import { TAMANO_MAXIMO_BYTES, contenidoDisposicion, decodificarNombre } from './archivo-pdf.js';
import { DatosInvalidosError } from './datos-carga.js';
import {
  DocumentosService,
  type DocumentoConVersiones,
  type DocumentoCreado,
  type PaginaDeDocumentos,
} from './documentos.service.js';
import { IdentificadorPipe, leerPaginacion } from './paginacion.js';

/** Lo único que se usa del archivo que entrega multer (en memoria). */
interface ArchivoSubido {
  originalname: string;
  buffer: Buffer;
}

function exigirUsuario(usuario: UsuarioSesion | undefined): UsuarioSesion {
  // El AuthGuard global ya lo garantiza; esto es por los tipos.
  if (!usuario) throw new UnauthorizedException('Se requiere iniciar sesión');
  return usuario;
}

@Controller('documentos')
export class DocumentosController {
  constructor(@Inject(DocumentosService) private readonly documentos: DocumentosService) {}

  /**
   * Carga un documento nuevo. Formulario multipart: el archivo en el campo `archivo` y los
   * datos `titulo`, `expediente`, `serieId`, `fechaDocumento` (AAAA-MM-DD) y `motivo` (opcional).
   * Las guardas corren antes que la lectura del cuerpo, así que quien no puede cargar no sube nada.
   */
  @Post()
  @Roles('administrador', 'editor')
  @UseInterceptors(
    FileInterceptor('archivo', {
      // Sin `storage` ni `dest`, multer guarda el archivo en memoria (`archivo.buffer`).
      // Al pasar el límite corta la lectura y Nest responde 413.
      limits: { fileSize: TAMANO_MAXIMO_BYTES, files: 1, fields: 10, fieldSize: 4096 },
    }),
  )
  async cargar(
    @Body() cuerpo: unknown,
    @UploadedFile() archivo: ArchivoSubido | undefined,
    @UsuarioActual() usuario: UsuarioSesion | undefined,
  ): Promise<DocumentoCreado> {
    try {
      return await this.documentos.cargar(
        cuerpo,
        archivo && { nombre: decodificarNombre(archivo.originalname), datos: archivo.buffer },
        exigirUsuario(usuario),
      );
    } catch (error) {
      if (error instanceof DatosInvalidosError) {
        throw new BadRequestException({ message: error.message, problemas: error.problemas });
      }
      throw error;
    }
  }

  @Get()
  listar(@Query() consulta: unknown): Promise<PaginaDeDocumentos> {
    const { pagina, tamano } = leerPaginacion(consulta);
    return this.documentos.listar(pagina, tamano);
  }

  @Get(':id')
  obtener(@Param('id', IdentificadorPipe) id: number): Promise<DocumentoConVersiones> {
    return this.documentos.obtener(id);
  }

  /** Descarga el PDF de una versión. Cualquier rol puede, y cada descarga queda en la auditoría. */
  @Get(':id/versiones/:numero/archivo')
  async descargar(
    @Param('id', IdentificadorPipe) id: number,
    @Param('numero', IdentificadorPipe) numero: number,
    @UsuarioActual() usuario: UsuarioSesion | undefined,
  ): Promise<StreamableFile> {
    const { datos, nombre } = await this.documentos.descargar(id, numero, exigirUsuario(usuario));
    return new StreamableFile(datos, {
      type: 'application/pdf',
      disposition: contenidoDisposicion(nombre),
      length: datos.length,
    });
  }
}
