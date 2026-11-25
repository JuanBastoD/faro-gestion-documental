import { describe, expect, it } from 'vitest';
import { archivoPdf } from '../pruebas/ayudas';
import {
  validarArchivo,
  validarClaveActual,
  validarClaveInicial,
  validarClaveNueva,
  validarClaveTemporal,
  validarFecha,
  validarFechaDeFiltro,
  validarNombreDeUsuario,
  validarNumeroDeDocumento,
  validarOrdenDeFechas,
  validarRepeticionDeClave,
  validarTexto,
} from './validacion';

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

describe('validarNombreDeUsuario', () => {
  it.each(['ana', 'ana.demo', 'a1b', 'ana_perez-2', '1abc', 'a'.repeat(64)])('«%s» pasa', (valor) => {
    expect(validarNombreDeUsuario(valor)).toBeUndefined();
  });

  it('los espacios de los extremos no cuentan, como en la API (que los recorta)', () => {
    expect(validarNombreDeUsuario('  ana.demo  ')).toBeUndefined();
  });

  it('vacío o solo espacios: lo pide', () => {
    expect(validarNombreDeUsuario('')).toMatch(/Escribe el nombre de usuario/);
    expect(validarNombreDeUsuario('   ')).toMatch(/Escribe el nombre de usuario/);
  });

  it('el mínimo es 3 y el máximo 64: justo en el borde pasa, uno más allá no', () => {
    expect(validarNombreDeUsuario('ab')).toMatch(/Mínimo 3 caracteres: este tiene 2/);
    expect(validarNombreDeUsuario('abc')).toBeUndefined();
    expect(validarNombreDeUsuario('a'.repeat(65))).toMatch(/Máximo 64 caracteres: este tiene 65/);
  });

  it('con mayúsculas no pasa, y propone cómo escribirlo en minúsculas', () => {
    expect(validarNombreDeUsuario('Ana.Demo')).toMatch(/minúsculas, por ejemplo «ana\.demo»/);
  });

  it.each(['.ana', '-ana', '_ana', 'ana demo', 'ana@demo', 'añá.demo', 'ana/demo'])('«%s» no pasa', (valor) => {
    expect(validarNombreDeUsuario(valor)).toMatch(/Usa solo letras minúsculas sin tilde/);
  });
});

describe('validarClaveInicial', () => {
  it('vacía: la pide', () => {
    expect(validarClaveInicial('')).toBe('Escribe la clave inicial.');
  });

  it('solo espacios: no cuenta aunque pase del mínimo', () => {
    expect(validarClaveInicial(' '.repeat(20))).toMatch(/no puede ser solo espacios/);
  });

  it('el mínimo es 12 y el máximo 256: justo en el borde pasa, uno más allá no', () => {
    expect(validarClaveInicial('x'.repeat(11))).toMatch(/Mínimo 12 caracteres: esta tiene 11/);
    expect(validarClaveInicial('x'.repeat(12))).toBeUndefined();
    expect(validarClaveInicial('x'.repeat(256))).toBeUndefined();
    expect(validarClaveInicial('x'.repeat(257))).toMatch(/Máximo 256 caracteres: esta tiene 257/);
  });

  it('no se recorta: los espacios de los extremos cuentan como parte de la clave (igual que en la API)', () => {
    expect(validarClaveInicial(`  ${'x'.repeat(8)}  `)).toBeUndefined();
    expect(validarClaveInicial(`  ${'x'.repeat(7)}  `)).toMatch(/esta tiene 11/);
  });

  it('el mensaje de error nunca repite la clave escrita', () => {
    const escrita = 'abc';
    expect(validarClaveInicial(escrita)).not.toContain(escrita);
  });
});

describe('validarNumeroDeDocumento', () => {
  it('vacío está bien (es un filtro opcional)', () => {
    expect(validarNumeroDeDocumento('')).toBeUndefined();
    expect(validarNumeroDeDocumento('  ')).toBeUndefined();
  });

  it('un entero positivo pasa', () => {
    expect(validarNumeroDeDocumento('1')).toBeUndefined();
    expect(validarNumeroDeDocumento(' 12 ')).toBeUndefined();
  });

  it.each(['0', '-3', '1.5', 'doce', '12a', '12345678901'])('«%s» no pasa', (valor) => {
    expect(validarNumeroDeDocumento(valor)).toMatch(/Escribe solo el número del documento/);
  });
});

describe('filtros de fecha', () => {
  it('una fecha de filtro vacía está bien; una que no existe, no', () => {
    expect(validarFechaDeFiltro('')).toBeUndefined();
    expect(validarFechaDeFiltro('2026-11-22')).toBeUndefined();
    expect(validarFechaDeFiltro('2026-02-31')).toMatch(/no existe/);
  });

  it('«desde» puede ser igual a «hasta» (un solo día), pero no posterior', () => {
    expect(validarOrdenDeFechas('2026-11-22', '2026-11-22')).toBeUndefined();
    expect(validarOrdenDeFechas('2026-11-21', '2026-11-22')).toBeUndefined();
    expect(validarOrdenDeFechas('2026-11-23', '2026-11-22')).toMatch(/«desde» no puede ser posterior a «hasta»/);
  });

  it('con una de las dos vacía no hay nada que comparar', () => {
    expect(validarOrdenDeFechas('', '2026-11-22')).toBeUndefined();
    expect(validarOrdenDeFechas('2026-11-22', '')).toBeUndefined();
    expect(validarOrdenDeFechas('', '')).toBeUndefined();
  });
});

describe('claves: temporal, actual, nueva y su repetición (#51)', () => {
  const CLAVE_ACTUAL = 'x'.repeat(14);
  const CLAVE_OTRA = 'y'.repeat(14);

  it('la clave temporal sigue las reglas de la API: 12 a 256, no solo espacios, sin recortar', () => {
    expect(validarClaveTemporal('')).toBe('Escribe la clave temporal o genera una.');
    expect(validarClaveTemporal(' '.repeat(20))).toMatch(/solo espacios/);
    expect(validarClaveTemporal('x'.repeat(11))).toMatch(/Mínimo 12 caracteres: esta tiene 11/);
    expect(validarClaveTemporal('x'.repeat(12))).toBeUndefined();
    expect(validarClaveTemporal('x'.repeat(256))).toBeUndefined();
    expect(validarClaveTemporal('x'.repeat(257))).toMatch(/Máximo 256 caracteres: esta tiene 257/);
    expect(validarClaveTemporal(`  ${'x'.repeat(8)}  `)).toBeUndefined();
  });

  it('la clave actual solo se pide: no se le exige la forma de una clave nueva (la API decide si es la correcta)', () => {
    expect(validarClaveActual('')).toBe('Escribe tu clave actual.');
    expect(validarClaveActual('corta')).toBeUndefined();
    expect(validarClaveActual('x'.repeat(256))).toBeUndefined();
    expect(validarClaveActual('x'.repeat(257))).toMatch(/Máximo 256/);
  });

  it('la clave nueva cumple las reglas y es distinta de la actual', () => {
    expect(validarClaveNueva('', CLAVE_ACTUAL)).toBe('Escribe la clave nueva.');
    expect(validarClaveNueva('x'.repeat(11), CLAVE_ACTUAL)).toMatch(/Mínimo 12 caracteres/);
    expect(validarClaveNueva(CLAVE_ACTUAL, CLAVE_ACTUAL)).toBe('La clave nueva debe ser distinta de la actual.');
    expect(validarClaveNueva(CLAVE_OTRA, CLAVE_ACTUAL)).toBeUndefined();
  });

  it('la repetición debe existir y coincidir con la clave nueva', () => {
    expect(validarRepeticionDeClave(CLAVE_OTRA, '')).toMatch(/Vuelve a escribir la clave nueva/);
    expect(validarRepeticionDeClave(CLAVE_OTRA, CLAVE_ACTUAL)).toMatch(/No coincide/);
    expect(validarRepeticionDeClave(CLAVE_OTRA, `${CLAVE_OTRA} `)).toMatch(/No coincide/);
    expect(validarRepeticionDeClave(CLAVE_OTRA, CLAVE_OTRA)).toBeUndefined();
  });
});
