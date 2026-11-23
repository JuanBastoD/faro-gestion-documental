import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ACCION } from '../auditoria/acciones.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { hashDeRelleno, verificar } from './hash-clave.js';
import type { UsuarioSesion } from './roles.js';
import { SesionesRepository } from './sesiones.repository.js';
import { UsuariosRepository } from './usuarios.repository.js';

/** Una sesión sin uso vence a las 8 horas. */
export const INACTIVIDAD_MS = 8 * 60 * 60 * 1000;
/** Aunque se use sin parar, una sesión no pasa de 7 días. */
export const DURACION_MAXIMA_MS = 7 * 24 * 60 * 60 * 1000;
/** Para no escribir en la base en cada petición, la vigencia se renueva como mucho una vez por minuto. */
export const RENOVAR_DESPUES_MS = 60 * 1000;

/** El mismo mensaje para usuario inexistente, inactivo o clave errónea: no se revela cuál fue. */
const MENSAJE_INGRESO_FALLIDO = 'Usuario o clave incorrectos';

/** Lo que se guarda en la base es la huella del token, nunca el token. */
export function huellaDeToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(UsuariosRepository) private readonly usuarios: UsuariosRepository,
    @Inject(SesionesRepository) private readonly sesiones: SesionesRepository,
    @Inject(AuditoriaService) private readonly auditoria: AuditoriaService,
  ) {}

  /** Verifica las credenciales y abre una sesión. Devuelve el token para la cookie. */
  async ingresar(
    usuario: string,
    clave: string,
  ): Promise<{ token: string; usuario: UsuarioSesion }> {
    const fila = await this.usuarios.buscarPorUsuario(usuario);
    // Se verifica siempre, aunque el usuario no exista, para que el tiempo no delate cuáles existen.
    const claveCorrecta = await verificar(fila?.claveHash ?? (await hashDeRelleno()), clave);

    if (!fila || !fila.activo || !claveCorrecta) {
      // El detalle no incluye el nombre escrito: a veces la gente escribe su clave en ese campo.
      const motivo = !fila
        ? 'usuario inexistente'
        : !fila.activo
          ? 'usuario inactivo'
          : 'clave incorrecta';
      await this.auditoria.registrar({
        usuarioId: fila?.id ?? null,
        accion: ACCION.INGRESO_FALLIDO,
        detalle: motivo,
      });
      throw new UnauthorizedException(MENSAJE_INGRESO_FALLIDO);
    }

    const ahora = new Date();
    const token = randomBytes(32).toString('hex');
    await this.sesiones.borrarVencidasDe(fila.id, ahora);
    await this.sesiones.crear({
      id: huellaDeToken(token),
      usuarioId: fila.id,
      venceEn: new Date(ahora.getTime() + INACTIVIDAD_MS),
    });
    await this.auditoria.registrar({ usuarioId: fila.id, accion: ACCION.INGRESO });

    return {
      token,
      usuario: { id: fila.id, usuario: fila.usuario, nombre: fila.nombre, rol: fila.rol },
    };
  }

  /** Devuelve quién es el dueño del token, o null si no hay sesión vigente. Renueva la vigencia. */
  async validarSesion(token: string): Promise<UsuarioSesion | null> {
    const id = huellaDeToken(token);
    const ahora = new Date();
    const vigente = await this.sesiones.buscarVigente(
      id,
      ahora,
      new Date(ahora.getTime() - DURACION_MAXIMA_MS),
    );
    if (!vigente) return null;
    if (ahora.getTime() - vigente.ultimoUso.getTime() > RENOVAR_DESPUES_MS) {
      await this.sesiones.renovar(id, ahora, new Date(ahora.getTime() + INACTIVIDAD_MS));
    }
    return vigente.usuario;
  }

  async cerrarSesion(token: string, usuario: UsuarioSesion): Promise<void> {
    await this.sesiones.borrar(huellaDeToken(token));
    await this.auditoria.registrar({ usuarioId: usuario.id, accion: ACCION.CIERRE_SESION });
  }
}
