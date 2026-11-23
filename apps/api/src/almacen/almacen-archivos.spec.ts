import { ClaveInvalidaError, validarClave, validarPrefijo } from './almacen-archivos.js';
import { calcularHuerfanos } from './huerfanos.js';

describe('validarClave', () => {
  it.each([
    `documentos/${'a'.repeat(64)}.pdf`,
    'documentos/abc.pdf',
    'a',
    'carpeta/sub-carpeta/archivo_1.tar.gz',
  ])('acepta %s', (clave) => {
    expect(() => validarClave(clave)).not.toThrow();
  });

  it.each([
    ['vacía', ''],
    ['con ..', '../secreto'],
    ['con .. en medio', 'documentos/../secreto.pdf'],
    ['absoluta', '/etc/passwd'],
    ['de Windows', 'C:\\datos\\x.pdf'],
    ['con barra invertida', 'documentos\\x.pdf'],
    ['con segmento vacío', 'documentos//x.pdf'],
    ['que termina en barra', 'documentos/'],
    ['con mayúsculas', 'Documentos/X.pdf'],
    ['con espacio', 'documentos/mi archivo.pdf'],
    ['oculta', '.oculto'],
    ['con segmento oculto', 'documentos/.oculto'],
    ['con carácter nulo', 'documentos/x\0.pdf'],
    ['demasiado larga', 'a'.repeat(301)],
  ])('rechaza una clave %s', (_caso, clave) => {
    expect(() => validarClave(clave)).toThrow(ClaveInvalidaError);
  });
});

describe('validarPrefijo', () => {
  it.each(['', 'documentos', 'documentos/'])('acepta %j', (prefijo) => {
    expect(() => validarPrefijo(prefijo)).not.toThrow();
  });

  it.each(['../x', '/abs', 'doc//x'])('rechaza %j', (prefijo) => {
    expect(() => validarPrefijo(prefijo)).toThrow(ClaveInvalidaError);
  });
});

describe('calcularHuerfanos', () => {
  const ahora = new Date('2026-11-22T12:00:00Z');
  const hace = (minutos: number) => new Date(ahora.getTime() - minutos * 60_000);
  const objetos = [
    { clave: 'documentos/usado.pdf', modificadoEn: hace(600) },
    { clave: 'documentos/huerfano-viejo.pdf', modificadoEn: hace(600) },
    { clave: 'documentos/huerfano-reciente.pdf', modificadoEn: hace(5) },
    { clave: 'documentos/justo-en-el-limite.pdf', modificadoEn: hace(60) },
  ];

  it('devuelve solo los que nadie usa y tienen la antigüedad mínima', () => {
    const resultado = calcularHuerfanos(objetos, new Set(['documentos/usado.pdf']), ahora, 60 * 60_000);
    expect(resultado.map((o) => o.clave)).toEqual([
      'documentos/huerfano-viejo.pdf',
      'documentos/justo-en-el-limite.pdf',
    ]);
  });

  it('un objeto reciente sin referencia no se toca: puede ser una carga en curso', () => {
    const resultado = calcularHuerfanos(objetos, new Set(), ahora, 60 * 60_000);
    expect(resultado.map((o) => o.clave)).not.toContain('documentos/huerfano-reciente.pdf');
  });

  it('si todo está referenciado no hay huérfanos', () => {
    const todas = new Set(objetos.map((o) => o.clave));
    expect(calcularHuerfanos(objetos, todas, ahora, 0)).toEqual([]);
  });

  it('con un almacén vacío no hay huérfanos', () => {
    expect(calcularHuerfanos([], new Set(['x']), ahora, 0)).toEqual([]);
  });
});
