import type { ConteoIntentos, IntentosIngresoRepository } from './intentos-ingreso.repository.js';
import {
  DemasiadosIntentosError,
  LIMITE_POR_IP,
  LIMITE_POR_USUARIO,
  LimiteIngreso,
  VENTANA_SEG,
  claveDeUsuario,
} from './limite-ingreso.js';

const IP = '203.0.113.7';
const VACIO: ConteoIntentos = { porUsuario: 0, porIp: 0, esperaUsuarioSeg: 0, esperaIpSeg: 0 };

describe('claveDeUsuario', () => {
  it('pasa a minúsculas, recorta los lados y acota la longitud', () => {
    expect(claveDeUsuario('  Editor.Demo ')).toBe('editor.demo');
    expect(claveDeUsuario('A'.repeat(500))).toHaveLength(64);
  });
});

describe('LimiteIngreso', () => {
  let conteos: ConteoIntentos[];
  let registrados: Array<{ usuario: string; ip: string }>;
  let olvidados: string[];
  let purgas: number;
  let ventanas: number[];
  let limite: LimiteIngreso;

  beforeEach(() => {
    conteos = [];
    registrados = [];
    olvidados = [];
    purgas = 0;
    ventanas = [];
    const repositorio = {
      contar: async (_usuario: string, _ip: string, ventanaSeg: number) => {
        ventanas.push(ventanaSeg);
        const siguiente = conteos.shift();
        if (!siguiente) throw new Error('la prueba no preparó este conteo');
        return siguiente;
      },
      registrar: async (usuario: string, ip: string) => void registrados.push({ usuario, ip }),
      olvidarUsuario: async (usuario: string) => void olvidados.push(usuario),
      purgarAntiguos: async () => void purgas++,
    } as unknown as IntentosIngresoRepository;
    limite = new LimiteIngreso(repositorio);
  });

  const atrapar = (promesa: Promise<unknown>) => promesa.then(() => undefined, (e: unknown) => e);

  it('deja pasar un primer intento, lo registra normalizado y no alcanza ningún límite', async () => {
    conteos.push(VACIO, { ...VACIO, porUsuario: 1, porIp: 1 });
    const reserva = await limite.reservar('  Editor ', IP);
    expect(reserva).toEqual({ alcanzados: [] });
    expect(registrados).toEqual([{ usuario: 'editor', ip: IP }]);
    expect(ventanas).toEqual([VENTANA_SEG, VENTANA_SEG]);
  });

  it(`el intento número ${LIMITE_POR_USUARIO} pasa y avisa que agotó el límite del usuario`, async () => {
    conteos.push(
      { ...VACIO, porUsuario: LIMITE_POR_USUARIO - 1, porIp: 4 },
      { ...VACIO, porUsuario: LIMITE_POR_USUARIO, porIp: 5 },
    );
    expect(await limite.reservar('editor', IP)).toEqual({ alcanzados: ['usuario'] });
  });

  it(`el intento número ${LIMITE_POR_IP} de una IP pasa y avisa que agotó el límite de la IP`, async () => {
    conteos.push(
      { ...VACIO, porUsuario: 0, porIp: LIMITE_POR_IP - 1 },
      { ...VACIO, porUsuario: 1, porIp: LIMITE_POR_IP },
    );
    expect(await limite.reservar('otro', IP)).toEqual({ alcanzados: ['ip'] });
  });

  it('si el usuario ya agotó sus intentos, se rechaza SIN registrar nada (insistir no alarga el bloqueo)', async () => {
    conteos.push({ ...VACIO, porUsuario: LIMITE_POR_USUARIO, esperaUsuarioSeg: 480 });
    const error = await atrapar(limite.reservar('editor', IP));
    expect(error).toBeInstanceOf(DemasiadosIntentosError);
    expect((error as DemasiadosIntentosError).esperaSeg).toBe(480);
    expect(registrados).toEqual([]);
  });

  it('si la IP ya agotó sus intentos, se rechaza aunque el usuario esté limpio', async () => {
    conteos.push({ ...VACIO, porUsuario: 0, porIp: LIMITE_POR_IP, esperaIpSeg: 300 });
    const error = await atrapar(limite.reservar('nuevo', IP));
    expect((error as DemasiadosIntentosError).esperaSeg).toBe(300);
    expect(registrados).toEqual([]);
  });

  it('espera lo que tarde el límite que se superó, no el de otro que no se superó', async () => {
    conteos.push({ porUsuario: LIMITE_POR_USUARIO, porIp: 3, esperaUsuarioSeg: 100, esperaIpSeg: 900 });
    expect(((await atrapar(limite.reservar('editor', IP))) as DemasiadosIntentosError).esperaSeg).toBe(100);
  });

  it('si superados los dos, espera el mayor; y nunca menos de un segundo', async () => {
    conteos.push({ porUsuario: LIMITE_POR_USUARIO, porIp: LIMITE_POR_IP, esperaUsuarioSeg: 100, esperaIpSeg: 700 });
    expect(((await atrapar(limite.reservar('a', IP))) as DemasiadosIntentosError).esperaSeg).toBe(700);
    conteos.push({ ...VACIO, porUsuario: LIMITE_POR_USUARIO, esperaUsuarioSeg: 0 });
    expect(((await atrapar(limite.reservar('b', IP))) as DemasiadosIntentosError).esperaSeg).toBe(1);
  });

  it('si otros intentos entraron a la vez y este quedó por encima, se rechaza (después de registrarse)', async () => {
    conteos.push(
      { ...VACIO, porUsuario: LIMITE_POR_USUARIO - 1 },
      { ...VACIO, porUsuario: LIMITE_POR_USUARIO + 1, esperaUsuarioSeg: 60 },
    );
    const error = await atrapar(limite.reservar('editor', IP));
    expect(error).toBeInstanceOf(DemasiadosIntentosError);
    expect(registrados).toHaveLength(1);
  });

  it('perdonar borra los intentos del usuario (normalizado) y limpia lo viejo', async () => {
    await limite.perdonar(' EDITOR ');
    expect(olvidados).toEqual(['editor']);
    expect(purgas).toBe(1);
  });
});
