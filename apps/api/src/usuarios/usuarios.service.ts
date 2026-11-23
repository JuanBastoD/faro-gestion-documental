import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ACCION } from '../auditoria/acciones.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { hashear } from '../auth/hash-clave.js';
import type { UsuarioSesion } from '../auth/roles.js';
import type { CambioDeUsuario, NuevoUsuario } from './datos-usuario.js';
import {
  UsuariosAdminRepository,
  type UsuarioAdministrado,
} from './usuarios-admin.repository.js';

/** Código de PostgreSQL para una violación de restricción única. */
const VIOLACION_UNICA = '23505';

function esViolacionUnica(error: unknown): boolean {
  // Drizzle envuelve el error de pg: el código puede estar en el error o en su causa.
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code === VIOLACION_UNICA || e?.cause?.code === VIOLACION_UNICA;
}

/**
 * Administración de usuarios. Nunca se borra a nadie: desactivar conserva quién cargó qué (trazabilidad
 * ante entes de control) y cierra sus sesiones al instante. Cada cambio queda en la auditoría dentro
 * de la misma transacción que lo hace.
 */
@Injectable()
export class UsuariosService {
  constructor(
    @Inject(UsuariosAdminRepository) private readonly repositorio: UsuariosAdminRepository,
    @Inject(AuditoriaService) private readonly auditoria: AuditoriaService,
  ) {}

  listar(): Promise<UsuarioAdministrado[]> {
    return this.repositorio.listar();
  }

  async crear(datos: NuevoUsuario, actor: UsuarioSesion): Promise<UsuarioAdministrado> {
    // El hash es lento a propósito: se calcula antes de abrir la transacción para no retener la conexión.
    const claveHash = await hashear(datos.clave);
    try {
      return await this.repositorio.enTransaccion(async (tx) => {
        const creado = await this.repositorio.insertar(tx, {
          usuario: datos.usuario,
          nombre: datos.nombre,
          rol: datos.rol,
          claveHash,
        });
        await this.auditoria.registrar(
          {
            usuarioId: actor.id,
            accion: ACCION.USUARIO_CREADO,
            detalle: `${this.quien(creado)}; rol ${creado.rol}`,
          },
          tx,
        );
        return creado;
      });
    } catch (error) {
      // También atrapa dos creaciones simultáneas del mismo nombre: la restricción única decide.
      if (esViolacionUnica(error)) {
        throw new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          codigo: 'usuario_existente',
          message: `Ya existe un usuario con el nombre ${datos.usuario}`,
        });
      }
      throw error;
    }
  }

  async cambiar(id: number, cambio: CambioDeUsuario, actor: UsuarioSesion): Promise<UsuarioAdministrado> {
    return this.repositorio.enTransaccion(async (tx) => {
      // Siempre en este orden (primero los administradores, luego el usuario): así dos cambios
      // simultáneos nunca se bloquean entre sí.
      const administradores = await this.repositorio.bloquearAdministradoresActivos(tx);
      const actual = await this.repositorio.buscarBloqueando(tx, id);
      if (!actual) throw new NotFoundException(`No existe el usuario ${id}`);

      const nuevoRol = cambio.rol ?? actual.rol;
      const nuevoActivo = cambio.activo ?? actual.activo;
      if (nuevoRol === actual.rol && nuevoActivo === actual.activo) return actual; // nada cambia, nada se registra

      const eraAdministradorActivo = actual.rol === 'administrador' && actual.activo;
      const dejaDeSerlo = eraAdministradorActivo && (nuevoRol !== 'administrador' || !nuevoActivo);
      if (dejaDeSerlo && administradores.every((adminId) => adminId === actual.id)) {
        throw new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          codigo: 'ultimo_administrador',
          message:
            'No se puede desactivar ni cambiar el rol del último administrador activo: el sistema se quedaría sin quien lo administre. Antes crea o activa a otro administrador.',
        });
      }

      const actualizado = await this.repositorio.actualizar(tx, id, { rol: nuevoRol, activo: nuevoActivo });
      const quien = this.quien(actualizado);

      if (nuevoRol !== actual.rol) {
        await this.auditoria.registrar(
          {
            usuarioId: actor.id,
            accion: ACCION.USUARIO_ROL_CAMBIADO,
            detalle: `${quien}; rol ${actual.rol} → ${nuevoRol}`,
          },
          tx,
        );
      }
      if (nuevoActivo !== actual.activo) {
        if (nuevoActivo) {
          await this.auditoria.registrar(
            { usuarioId: actor.id, accion: ACCION.USUARIO_REACTIVADO, detalle: quien },
            tx,
          );
        } else {
          const cerradas = await this.repositorio.borrarSesiones(tx, id);
          await this.auditoria.registrar(
            {
              usuarioId: actor.id,
              accion: ACCION.USUARIO_DESACTIVADO,
              detalle: `${quien}; sesiones cerradas: ${cerradas}`,
            },
            tx,
          );
        }
      }
      return actualizado;
    });
  }

  /** «usuario 7 (ana.perez)»: el número no cambia nunca; el nombre ayuda a leer la auditoría. */
  private quien(u: Pick<UsuarioAdministrado, 'id' | 'usuario'>): string {
    return `usuario ${u.id} (${u.usuario})`;
  }
}
