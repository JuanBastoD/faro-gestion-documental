import { Logger } from '@nestjs/common';
import { SaludService, type ConsultaBase } from './salud.service.js';

const baseSana: ConsultaBase = { query: async () => ({ rows: [{ '?column?': 1 }] }) };
const baseCaida: ConsultaBase = {
  query: async () => {
    throw new Error('connect ECONNREFUSED 127.0.0.1:5433 (usuario faro, clave interna)');
  },
};

describe('SaludService', () => {
  let registroError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Los fallos simulados escriben en el registro; se captura para no ensuciar la salida.
    registroError = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    registroError.mockRestore();
  });

  it('informa ok cuando la base responde', async () => {
    const informe = await new SaludService(baseSana).verificar();
    expect(informe.estado).toBe('ok');
    expect(informe.api.estado).toBe('ok');
    expect(informe.api.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(informe.base.estado).toBe('ok');
    expect(Number.isNaN(Date.parse(informe.momento))).toBe(false);
  });

  it('informa degradado cuando la base falla, sin filtrar el detalle del error', async () => {
    const informe = await new SaludService(baseCaida).verificar();
    expect(informe.estado).toBe('degradado');
    expect(informe.api.estado).toBe('ok');
    expect(informe.base).toEqual({ estado: 'error' });
    expect(JSON.stringify(informe)).not.toContain('ECONNREFUSED');
    // El detalle sí queda en el registro del servidor.
    expect(registroError).toHaveBeenCalledWith(expect.stringContaining('ECONNREFUSED'));
  });

  it('no se queda esperando si la base nunca contesta', async () => {
    vi.useFakeTimers();
    try {
      const colgada: ConsultaBase = { query: () => new Promise(() => {}) };
      const pendiente = new SaludService(colgada).verificar();
      await vi.advanceTimersByTimeAsync(2500);
      const informe = await pendiente;
      expect(informe.estado).toBe('degradado');
      expect(informe.base.estado).toBe('error');
    } finally {
      vi.useRealTimers();
    }
  });
});
