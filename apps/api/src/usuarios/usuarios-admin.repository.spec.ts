import type { BaseDatos } from '../base-datos/base-datos.module.js';
import {
  INTENTOS_DE_TRANSACCION,
  UsuariosAdminRepository,
  type Transaccion,
} from './usuarios-admin.repository.js';

/** Error como lo entrega pg, con el código de PostgreSQL. */
function errorDePg(code: string): Error & { code: string } {
  return Object.assign(new Error(`error de pg ${code}`), { code });
}

/** Error como lo entrega Drizzle: envuelve al de pg y deja el código en `cause`. */
function errorDeDrizzle(code: string): Error {
  return Object.assign(new Error('Failed query: ...'), { cause: errorDePg(code) });
}

const TX = { esTransaccion: true } as unknown as Transaccion;

/** Un repositorio cuya base falsa ejecuta el trabajo con una transacción falsa cada vez que se le pide una. */
function crear() {
  const transaction = vi.fn((trabajo: (tx: Transaccion) => Promise<unknown>) => trabajo(TX));
  const repositorio = new UsuariosAdminRepository({ transaction } as unknown as BaseDatos);
  return { repositorio, transaction };
}

describe('UsuariosAdminRepository.enTransaccion', () => {
  it('sin errores: una sola vez y devuelve lo que devuelve el trabajo', async () => {
    const { repositorio, transaction } = crear();
    const trabajo = vi.fn((tx: Transaccion) => Promise.resolve({ tx }));
    await expect(repositorio.enTransaccion(trabajo)).resolves.toEqual({ tx: TX });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(trabajo).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['abrazo mortal (40P01)', '40P01'],
    ['fallo de serialización (40001)', '40001'],
  ])('%s: se repite entera y la segunda vez sale bien', async (_nombre, codigo) => {
    const { repositorio, transaction } = crear();
    let llamadas = 0;
    const resultado = await repositorio.enTransaccion(() => {
      llamadas++;
      return llamadas === 1 ? Promise.reject(errorDePg(codigo)) : Promise.resolve('listo');
    });
    expect(resultado).toBe('listo');
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it('reconoce el código también cuando Drizzle lo deja en `cause`', async () => {
    const { repositorio, transaction } = crear();
    let llamadas = 0;
    const resultado = await repositorio.enTransaccion(() => {
      llamadas++;
      return llamadas < 3 ? Promise.reject(errorDeDrizzle('40P01')) : Promise.resolve(llamadas);
    });
    expect(resultado).toBe(3);
    expect(transaction).toHaveBeenCalledTimes(3);
  });

  it(`si sigue fallando se rinde a los ${INTENTOS_DE_TRANSACCION} intentos y entrega el último error`, async () => {
    const { repositorio, transaction } = crear();
    const trabajo = vi.fn(() => Promise.reject(errorDeDrizzle('40P01')));
    await expect(repositorio.enTransaccion(trabajo)).rejects.toMatchObject({ cause: { code: '40P01' } });
    expect(transaction).toHaveBeenCalledTimes(INTENTOS_DE_TRANSACCION);
    expect(trabajo).toHaveBeenCalledTimes(INTENTOS_DE_TRANSACCION);
  });

  it.each([
    ['violación de unicidad (23505)', errorDeDrizzle('23505')],
    ['conexión caída (08006)', errorDePg('08006')],
    ['un error cualquiera', new Error('falla de lógica')],
  ])('%s: no se repite', async (_nombre, error) => {
    const { repositorio, transaction } = crear();
    await expect(repositorio.enTransaccion(() => Promise.reject(error))).rejects.toBe(error);
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
