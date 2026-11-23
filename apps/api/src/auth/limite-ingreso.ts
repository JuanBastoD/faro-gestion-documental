import { Inject, Injectable } from '@nestjs/common';
import { IntentosIngresoRepository, type ConteoIntentos } from './intentos-ingreso.repository.js';

/** Intentos de ingreso permitidos por usuario (existiera o no) en la ventana. [SUPUESTO] sin medir con uso real. */
export const LIMITE_POR_USUARIO = 5;
/**
 * Intentos permitidos por IP en la ventana. Más alto que el de usuario porque una oficina entera puede salir por
 * una sola IP (8 funcionarios y 21 contratistas) y los errores de digitación son normales. [SUPUESTO]
 */
export const LIMITE_POR_IP = 30;
/** Ventana de conteo: 15 minutos. */
export const VENTANA_SEG = 15 * 60;

/** Se superó el límite de intentos. `esperaSeg` es lo que debe esperar quien intenta. */
export class DemasiadosIntentosError extends Error {
  constructor(readonly esperaSeg: number) {
    super('Demasiados intentos de ingreso');
    this.name = 'DemasiadosIntentosError';
  }
}

export interface Reserva {
  /** Qué límites alcanzó este intento (era el último permitido). Si falla, el siguiente ya queda bloqueado. */
  alcanzados: Array<'usuario' | 'ip'>;
}

/** Lo escrito en el campo usuario, normalizado para contar: minúsculas, sin espacios de los lados, acotado. */
export function claveDeUsuario(usuario: string): string {
  return usuario.trim().toLowerCase().slice(0, 64);
}

function espera(conteo: ConteoIntentos, limites: { usuario: boolean; ip: boolean }): number {
  const candidatos = [
    limites.usuario ? conteo.esperaUsuarioSeg : 0,
    limites.ip ? conteo.esperaIpSeg : 0,
  ];
  return Math.max(1, ...candidatos);
}

/**
 * Límite de intentos de ingreso por usuario y por IP (ADR-009).
 *
 * El intento se **reserva antes** de verificar la clave: así un usuario ya bloqueado no cuesta una verificación
 * de argon2 (que es lenta a propósito) y, aunque lleguen muchos intentos a la vez, a lo sumo
 * `LIMITE_POR_USUARIO` pasan a verificarse: cada uno cuenta después de registrarse y el que queda por encima
 * del límite se rechaza.
 */
@Injectable()
export class LimiteIngreso {
  constructor(@Inject(IntentosIngresoRepository) private readonly intentos: IntentosIngresoRepository) {}

  /** Lanza `DemasiadosIntentosError` si no corresponde dejar pasar este intento. */
  async reservar(usuario: string, ip: string): Promise<Reserva> {
    const clave = claveDeUsuario(usuario);

    // Ya agotó los intentos: se rechaza sin registrar nada (así insistir no alarga el bloqueo ni llena la tabla).
    const antes = await this.intentos.contar(clave, ip, VENTANA_SEG);
    const usuarioAgotado = antes.porUsuario >= LIMITE_POR_USUARIO;
    const ipAgotada = antes.porIp >= LIMITE_POR_IP;
    if (usuarioAgotado || ipAgotada) {
      throw new DemasiadosIntentosError(espera(antes, { usuario: usuarioAgotado, ip: ipAgotada }));
    }

    await this.intentos.registrar(clave, ip);

    // Se vuelve a contar: si otros intentos entraron a la vez y este quedó por encima, se rechaza.
    const despues = await this.intentos.contar(clave, ip, VENTANA_SEG);
    const usuarioExcedido = despues.porUsuario > LIMITE_POR_USUARIO;
    const ipExcedida = despues.porIp > LIMITE_POR_IP;
    if (usuarioExcedido || ipExcedida) {
      throw new DemasiadosIntentosError(espera(despues, { usuario: usuarioExcedido, ip: ipExcedida }));
    }

    const alcanzados: Reserva['alcanzados'] = [];
    if (despues.porUsuario === LIMITE_POR_USUARIO) alcanzados.push('usuario');
    if (despues.porIp === LIMITE_POR_IP) alcanzados.push('ip');
    return { alcanzados };
  }

  /** Ingreso correcto: el usuario vuelve a empezar y se aprovecha para limpiar lo viejo. */
  async perdonar(usuario: string): Promise<void> {
    await this.intentos.olvidarUsuario(claveDeUsuario(usuario));
    await this.intentos.purgarAntiguos();
  }
}
