import { describe, expect, it, vi } from 'vitest';
import { archivoPdf, respuestaJson } from '../pruebas/ayudas';
import { versionDePrueba } from '../pruebas/carga';
import { agregarVersion, cargarDocumento, formularioDeCarga, restaurarVersion, type DatosDeCarga } from './documentos';

const BASE: DatosDeCarga = {
  archivo: archivoPdf('contrato.pdf'),
  titulo: '  Contrato de obra  ',
  expediente: ' EXP-100 ',
  serieId: 11,
  fechaDocumento: '2026-03-15',
};

function campos(formulario: FormData): Record<string, string> {
  const resultado: Record<string, string> = {};
  for (const [clave, valor] of formulario.entries()) {
    resultado[clave] = typeof valor === 'string' ? valor : `archivo:${valor.name}`;
  }
  return resultado;
}

describe('formulario de carga (contrato de POST /documentos)', () => {
  it('una carga normal lleva solo los datos y el archivo, sin decisión', () => {
    expect(campos(formularioDeCarga(BASE))).toEqual({
      titulo: 'Contrato de obra',
      expediente: 'EXP-100',
      serieId: '11',
      fechaDocumento: '2026-03-15',
      archivo: 'archivo:contrato.pdf',
    });
  });

  it('el motivo, si se escribió, va sin espacios sobrantes; vacío no se envía', () => {
    expect(campos(formularioDeCarga({ ...BASE, motivo: '  Lote 2  ' })).motivo).toBe('Lote 2');
    expect(campos(formularioDeCarga({ ...BASE, motivo: '   ' }))).not.toHaveProperty('motivo');
  });

  it('nueva_version lleva decision, documentoId y motivo, y nunca justificacion', () => {
    const enviado = campos(
      formularioDeCarga({ ...BASE, decision: 'nueva_version', documentoId: 7, motivo: 'Mejor calidad', justificacion: 'no debería ir' }),
    );
    expect(enviado).toMatchObject({ decision: 'nueva_version', documentoId: '7', motivo: 'Mejor calidad' });
    expect(enviado).not.toHaveProperty('justificacion');
  });

  it('documento_distinto lleva decision y justificacion, y nunca documentoId', () => {
    const enviado = campos(
      formularioDeCarga({ ...BASE, decision: 'documento_distinto', documentoId: 7, justificacion: '  Otro lote  ' }),
    );
    expect(enviado).toMatchObject({ decision: 'documento_distinto', justificacion: 'Otro lote' });
    expect(enviado).not.toHaveProperty('documentoId');
  });

  it('el archivo va al final, tras los campos de texto', () => {
    const claves = [...formularioDeCarga({ ...BASE, decision: 'nueva_version', documentoId: 7, motivo: 'x' }).keys()];
    expect(claves.at(-1)).toBe('archivo');
  });
});

describe('peticiones de carga, versión y restauración', () => {
  /** Una respuesta nueva en cada llamada: el cuerpo de una `Response` solo se puede leer una vez. */
  function simular(respuesta: () => Response) {
    const falso = vi.fn(async (_ruta: string, _init?: RequestInit) => respuesta());
    vi.stubGlobal('fetch', falso);
    return falso;
  }

  it('cargarDocumento hace POST /documentos con multipart, sin definir Content-Type', async () => {
    const falso = simular(() => respuestaJson({ documento: { id: 31 }, version: versionDePrueba(1) }, 201));
    await cargarDocumento(BASE);
    const [ruta, init] = falso.mock.calls[0];
    expect(ruta).toBe('/documentos');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeInstanceOf(FormData);
    expect(init?.headers).not.toHaveProperty('Content-Type');
    expect(init?.credentials).toBe('same-origin');
  });

  it('agregarVersion hace POST /documentos/:id/versiones con el archivo y el motivo', async () => {
    const falso = simular(() => respuestaJson(versionDePrueba(3), 201));
    await agregarVersion(12, archivoPdf('v3.pdf'), '  Se corrigió la cláusula 4  ');
    const [ruta, init] = falso.mock.calls[0];
    expect(ruta).toBe('/documentos/12/versiones');
    expect(init?.method).toBe('POST');
    expect(campos(init?.body as FormData)).toEqual({ motivo: 'Se corrigió la cláusula 4', archivo: 'archivo:v3.pdf' });
  });

  it('restaurarVersion hace POST .../restaurar con JSON; sin motivo envía un objeto vacío', async () => {
    const falso = simular(() => respuestaJson(versionDePrueba(4, { restauradaDe: 1 }), 201));
    await restaurarVersion(12, 1, '');
    await restaurarVersion(12, 1, '  Volvemos a la original  ');
    const [ruta, primera] = falso.mock.calls[0];
    expect(ruta).toBe('/documentos/12/versiones/1/restaurar');
    expect(primera?.method).toBe('POST');
    expect(primera?.body).toBe('{}');
    expect(falso.mock.calls[1][1]?.body).toBe('{"motivo":"Volvemos a la original"}');
  });
});
