import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ACCION } from '../auditoria/acciones.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { hashDeRelleno, hashear, verificar } from './hash-clave.js';
import { LimiteIngreso } from './limite-ingreso.js';
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

/**
 * Textos del detalle de auditoría que delatan el uso de una clave temporal (ADR-011 §4). Se conservan como
 * constantes porque una consulta de quien audita las busca: `docs/modelo-de-datos.md` §8 las documenta.
 */
const DETALLE_INGRESO_CON_CLAVE_TEMPORAL = 'con clave temporal';
const DETALLE_CAMBIO_DESDE_CLAVE_TEMPORAL = 'desde clave temporal';

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
    @Inject(LimiteIngreso) private readonly limite: LimiteIngreso,
  ) {}

  /**
   * Verifica las credenciales y abre una sesión. Devuelve el token para la cookie.
   * Lanza `DemasiadosIntentosError` si el usuario o la IP agotaron sus intentos (ADR-009): en ese caso ni siquiera
   * se verifica la clave.
   */
  async ingresar(
    usuario: string,
    clave: string,
    ip: string,
  ): Promise<{ token: string; usuario: UsuarioSesion }> {
    const reserva = await this.limite.reservar(usuario, ip);
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
      if (reserva.alcanzados.length > 0) {
        // Solo se audita el paso al bloqueo, no cada intento rechazado después: insistir no llena la auditoría.
        await this.auditoria.registrar({
          usuarioId: fila?.id ?? null,
          accion: ACCION.INGRESO_BLOQUEADO,
          detalle: `límite de intentos alcanzado por ${reserva.alcanzados.join(' e ')}`,
        });
      }
      throw new UnauthorizedException(MENSAJE_INGRESO_FALLIDO);
    }

    await this.limite.perdonar(usuario);
    const ahora = new Date();
    const token = randomBytes(32).toString('hex');
    await this.sesiones.borrarVencidasDe(fila.id, ahora);
    await this.sesiones.crear({
      id: huellaDeToken(token),
      usuarioId: fila.id,
      venceEn: new Date(ahora.getTime() + INACTIVIDAD_MS),
    });
    // Quien fijó la clave temporal la conoce y podría ingresar como esa persona (ADR-011 §4, H-01). La auditoría no
    // guarda IP, así que el rastro que queda es este: el ingreso con una cuenta pendiente de cambio se marca aparte.
    await this.auditoria.registrar({
      usuarioId: fila.id,
      accion: ACCION.INGRESO,
      ...(fila.debeCambiarClave ? { detalle: DETALLE_INGRESO_CON_CLAVE_TEMPORAL } : {}),
    });

    return {
      token,
      usuario: {
        id: fila.id,
        usuario: fila.usuario,
        nombre: fila.nombre,
        rol: fila.rol,
        debeCambiarClave: fila.debeCambiarClave,
      },
    };
  }

  /**
   * Cambia la clave de quien tiene sesión (ADR-011). Pide la clave actual aunque haya sesión: una cookie
   * robada no debería bastar para quedarse con la cuenta.
   *
   * Los fallos de la clave actual cuentan en el mismo límite del ingreso (ADR-009) y se reservan antes de
   * verificar: si no, esta ruta sería otra forma de adivinar la clave sin tope. Lanza
   * `DemasiadosIntentosError` si el límite está agotado; en ese caso ni se verifica la clave.
   *
   * La clave nueva, el cierre de las demás sesiones de la persona (la actual sigue abierta) y el evento de
   * auditoría se guardan en una sola transacción. Devuelve cuántas sesiones se cerraron.
   */
  async cambiarClave(
    usuario: UsuarioSesion,
    token: string,
    claveActual: string,
    claveNueva: string,
    ip: string,
  ): Promise<number> {
    const reserva = await this.limite.reservar(usuario.usuario, ip);
    const fila = await this.usuarios.buscarPorId(usuario.id);
    // La sesión era válida hace un instante: solo falta la fila si la desactivaron justo ahora.
    if (!fila || !fila.activo) throw new UnauthorizedException('Se requiere iniciar sesión');

    if (!(await verificar(fila.claveHash, claveActual))) {
      // Mismo catálogo que el ingreso: es el mismo tipo de fallo y se cuenta en el mismo límite.
      await this.auditoria.registrar({
        usuarioId: fila.id,
        accion: ACCION.INGRESO_FALLIDO,
        detalle: 'cambio de clave: clave actual incorrecta',
      });
      if (reserva.alcanzados.length > 0) {
        await this.auditoria.registrar({
          usuarioId: fila.id,
          accion: ACCION.INGRESO_BLOQUEADO,
          detalle: `límite de intentos alcanzado por ${reserva.alcanzados.join(' e ')}`,
        });
      }
      // 400 y no 401: la interfaz entiende 401 como «la sesión venció» y sacaría a la persona de la aplicación.
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        codigo: 'clave_actual_incorrecta',
        message: 'La clave actual no es correcta',
      });
    }

    await this.limite.perdonar(usuario.usuario);
    // El hash es lento a propósito: se calcula antes de abrir la transacción para no retener la conexión.
    const claveHashNueva = await hashear(claveNueva);
    const conservar = huellaDeToken(token);
    return this.usuarios.enTransaccion(async (tx) => {
      const escrita = await this.usuarios.fijarClavePropia(tx, fila.id, fila.claveHash, claveHashNueva);
      if (!escrita) {
        throw new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          codigo: 'conflicto_de_clave',
          message: 'La clave cambió mientras se procesaba tu petición. Vuelve a intentarlo con la clave actual.',
        });
      }
      const cerradas = await this.sesiones.borrarDeUsuarioExcepto(tx, fila.id, conservar);
      // `fila.debeCambiarClave` se leyó junto con el hash que se verificó, y la escritura solo prospera si ese hash
      // sigue siendo el de la cuenta: el indicador describe la clave desde la que se cambió (ADR-011 §4, H-01).
      const origen = fila.debeCambiarClave ? `${DETALLE_CAMBIO_DESDE_CLAVE_TEMPORAL}; ` : '';
      await this.auditoria.registrar(
        {
          usuarioId: fila.id,
          accion: ACCION.CLAVE_CAMBIADA,
          detalle: `${origen}otras sesiones cerradas: ${cerradas}`,
        },
        tx,
      );
      return cerradas;
    });
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
