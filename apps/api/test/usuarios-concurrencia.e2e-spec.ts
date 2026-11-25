import { ConflictException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { UsuarioSesion } from '../src/auth/roles.js';
import type { CambioDeUsuario } from '../src/usuarios/datos-usuario.js';
import { UsuariosAdminRepository } from '../src/usuarios/usuarios-admin.repository.js';
import { UsuariosService } from '../src/usuarios/usuarios.service.js';
import { crearApp, crearUsuario, limpiarTablas, type AppDePrueba } from './ayudas.js';

/** Generador pseudoaleatorio con semilla fija: el orden de cada ronda es distinto, pero siempre el mismo entre ejecuciones. */
function generador(semilla: number): () => number {
  let estado = semilla >>> 0;
  return () => {
    estado = (estado + 0x6d2b79f5) >>> 0;
    let t = estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mezclar<T>(lista: T[], azar: () => number): T[] {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(azar() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

/** Cuántos administradores activos hay ahora mismo (lo que ve cualquier otra conexión). */
const CUENTA_ADMINISTRADORES = `select count(*)::int as n from usuarios where rol = 'administrador' and activo`;

describe('Cambios simultáneos sobre los administradores (contra PostgreSQL real)', () => {
  let ctx: AppDePrueba;
  let servicio: UsuariosService;

  beforeAll(async () => {
    ctx = await crearApp();
    servicio = ctx.app.get(UsuariosService);
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  /**
   * Muchas rondas de cambios cruzados entre cuatro administradores, todos a la vez y por el servicio (sin pasar por las guardas HTTP,
   * para que de verdad coincidan las transacciones). Las degradaciones se mezclan con ascensos y reactivaciones, y quien actúa es
   * el primer administrador, que en casi todas las rondas es degradado por otro cambio mientras sus propios cambios siguen en vuelo.
   *
   * Regresión de un `deadlock detected` (40P01) intermitente: la inserción de auditoría pide, por la clave foránea, un bloqueo `FOR KEY SHARE`
   * sobre la fila de quien actúa. Con bloqueos `FOR UPDATE` en los administradores, esa petición, que llega al final, se cruzaba con
   * otra transacción que ya tenía bloqueada esa fila (aunque la hubiera descartado del resultado) y esperaba una fila de la primera.
   */
  it('rondas de cambios cruzados entre cuatro administradores: ningún error de la base, nunca cero administradores activos', async () => {
    const azar = generador(20261123);
    const rondas = 20;
    const fallos: string[] = [];
    let minimoVisto = Number.POSITIVE_INFINITY;
    let respondidos = 0;

    for (let ronda = 0; ronda < rondas; ronda++) {
      await limpiarTablas(ctx.pool);
      const ids: number[] = [];
      for (const nombre of ['admin.1', 'admin.2', 'admin.3', 'admin.4']) {
        ids.push(await crearUsuario(ctx.db, { usuario: nombre, rol: 'administrador' }));
      }
      const actor: UsuarioSesion = { id: ids[0], usuario: 'admin.1', nombre: 'Nombre de admin.1', rol: 'administrador', debeCambiarClave: false };

      const cambios: Array<[number, CambioDeUsuario]> = ids.flatMap((id) => [
        [id, { activo: false }],
        [id, { rol: 'editor' }],
        [id, { rol: 'consulta', activo: false }],
        [id, { rol: 'administrador' }],
        [id, { activo: true }],
      ]);

      // Vigilante: una conexión aparte que mira la cuenta de administradores mientras ocurre todo.
      let vigilando = true;
      const vigilante = (async () => {
        while (vigilando) {
          const { rows } = await ctx.pool.query(CUENTA_ADMINISTRADORES);
          minimoVisto = Math.min(minimoVisto, rows[0].n as number);
          await new Promise((resolver) => setTimeout(resolver, 1));
        }
      })();

      const resultados = await Promise.allSettled(
        mezclar(cambios, azar).map(([id, cambio]) => servicio.cambiar(id, cambio, actor)),
      );
      vigilando = false;
      await vigilante;

      for (const r of resultados) {
        if (r.status === 'fulfilled') {
          respondidos++;
        } else if (r.reason instanceof ConflictException) {
          respondidos++; // 409 «último administrador»: es la respuesta correcta cuando el cambio dejaría al sistema sin uno
        } else {
          const e = r.reason as { code?: string; cause?: { code?: string }; message?: string };
          fallos.push(`ronda ${ronda}: ${e.cause?.code ?? e.code ?? 'sin código'} ${String(e.message).slice(0, 120)}`);
        }
      }
      const { rows } = await ctx.pool.query(CUENTA_ADMINISTRADORES);
      expect(rows[0].n as number, `ronda ${ronda}`).toBeGreaterThanOrEqual(1);
      if (fallos.length > 0) break; // con un fallo no hace falta seguir: cada abrazo mortal tarda en detectarse
    }

    expect(fallos).toEqual([]);
    expect(minimoVisto).toBeGreaterThanOrEqual(1);
    expect(respondidos).toBe(rondas * 20);
  }, 60_000);

  /**
   * La defensa en profundidad: aunque algún día aparezca otro cruce de bloqueos, un abrazo mortal de verdad (aquí fabricado a mano
   * con dos transacciones que toman dos filas en orden inverso) no debe llegar al usuario como un error: PostgreSQL aborta a una,
   * `enTransaccion` la repite entera y las dos terminan.
   */
  it('un abrazo mortal real se repite solo: las dos transacciones terminan y la repetida no deja nada a medias', async () => {
    await limpiarTablas(ctx.pool);
    const a = await crearUsuario(ctx.db, { usuario: 'fila.a', rol: 'editor' });
    const b = await crearUsuario(ctx.db, { usuario: 'fila.b', rol: 'editor' });
    const repositorio = ctx.app.get(UsuariosAdminRepository);

    let llegaron = 0;
    let soltar!: () => void;
    const puerta = new Promise<void>((resolver) => (soltar = resolver));
    let ejecuciones = 0;

    // Cada una bloquea su primera fila, espera a que la otra también tenga la suya (solo la primera vez) y pide la de la otra.
    const cruzar = (primera: number, segunda: number, etiqueta: string) => {
      let intentos = 0;
      return repositorio.enTransaccion(async (tx) => {
        ejecuciones++;
        intentos++;
        await tx.execute(sql`select id from usuarios where id = ${primera} for update`);
        if (intentos === 1) {
          if (++llegaron === 2) soltar();
          await puerta;
        }
        await tx.execute(sql`select id from usuarios where id = ${segunda} for update`);
        await tx.execute(sql`update usuarios set nombre = ${`tocado por ${etiqueta}`} where id = ${primera}`);
        return intentos;
      });
    };

    const [intentosA, intentosB] = await Promise.all([cruzar(a, b, 'A'), cruzar(b, a, 'B')]);

    // Una de las dos fue la víctima del abrazo mortal y necesitó al menos una repetición.
    expect(Math.max(intentosA, intentosB)).toBeGreaterThanOrEqual(2);
    expect(ejecuciones).toBeGreaterThanOrEqual(3);
    const { rows } = await ctx.pool.query('select id, nombre from usuarios where id in ($1, $2) order by id', [a, b]);
    expect(rows).toEqual([
      { id: a, nombre: 'tocado por A' },
      { id: b, nombre: 'tocado por B' },
    ]);
  }, 30_000);
});
