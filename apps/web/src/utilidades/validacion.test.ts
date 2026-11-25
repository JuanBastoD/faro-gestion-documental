import { describe, expect, it } from 'vitest';
import { archivoPdf } from '../pruebas/ayudas';
import { validarArchivo, validarFecha, validarTexto } from './validacion';

describe('validarArchivo', () => {
  it('sin archivo: lo pide', () => {
    expect(validarArchivo(null)).toMatch(/Elige el archivo PDF/);
  });

  it('un PDF normal pasa', () => {
    expect(validarArchivo(archivoPdf('acta.pdf'))).toBeUndefined();
  });

  it('se acepta por tipo o por extensión', () => {
    expect(validarArchivo(new File(['x'], 'sin-extension', { type: 'application/pdf' }))).toBeUndefined();
    expect(validarArchivo(new File(['x'], 'ACTA.PDF', { type: '' }))).toBeUndefined();
  });

  it('una imagen o un texto no pasan, y se dice por qué', () => {
    expect(validarArchivo(new File(['x'], 'foto.png', { type: 'image/png' }))).toMatch(/no es un PDF/);
    expect(validarArchivo(new File(['x'], 'notas.txt', { type: 'text/plain' }))).toMatch(/no es un PDF/);
  });

  it('un archivo vacío no pasa', () => {
    expect(validarArchivo(new File([], 'vacio.pdf', { type: 'application/pdf' }))).toMatch(/vacío/);
  });

  it('el límite es de 20 MB: justo 20 MB pasa, un byte más no', () => {
    const veinte = 20 * 1024 * 1024;
    expect(validarArchivo(archivoPdf('justo.pdf', veinte))).toBeUndefined();
    expect(validarArchivo(archivoPdf('grande.pdf', veinte + 1))).toMatch(/Pasa de 20 MB/);
  });

  it('el aviso de tamaño dice cuánto pesa el archivo', () => {
    expect(validarArchivo(archivoPdf('grande.pdf', 25 * 1024 * 1024))).toContain('25,0 MB');
  });
});

describe('validarTexto', () => {
  it('obligatorio: vacío o solo espacios no cuenta', () => {
    expect(validarTexto('', 10, 'Falta.')).toBe('Falta.');
    expect(validarTexto('   ', 10, 'Falta.')).toBe('Falta.');
  });

  it('opcional: vacío está bien', () => {
    expect(validarTexto('', 10)).toBeUndefined();
    expect(validarTexto('   ', 10)).toBeUndefined();
  });

  it('el máximo se cuenta sin los espacios de los extremos, como la API', () => {
    expect(validarTexto('  1234567890  ', 10, 'Falta.')).toBeUndefined();
    expect(validarTexto('12345678901', 10, 'Falta.')).toMatch(/Máximo 10 caracteres: este tiene 11/);
  });
});

describe('validarFecha', () => {
  it('una fecha real pasa', () => {
    expect(validarFecha('2026-03-15')).toBeUndefined();
    expect(validarFecha('2028-02-29')).toBeUndefined();
  });

  it('vacía: la pide', () => {
    expect(validarFecha('')).toMatch(/Indica la fecha/);
  });

  it('con otro formato: da un ejemplo', () => {
    expect(validarFecha('15/03/2026')).toMatch(/AAAA-MM-DD/);
  });

  it('un día que no existe no pasa (la API también lo rechaza)', () => {
    expect(validarFecha('2026-02-31')).toMatch(/no existe/);
    expect(validarFecha('2027-02-29')).toMatch(/no existe/);
    expect(validarFecha('2026-13-01')).toMatch(/no existe/);
  });

  it('un año de tres cifras mal tecleado se avisa', () => {
    expect(validarFecha('0202-03-15')).toMatch(/Revisa el año/);
  });
});
