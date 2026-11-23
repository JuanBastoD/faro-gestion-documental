import { analizarCsv, CodificacionInvalidaError, decodificar, detectarSeparador } from './csv.js';

const campos = (texto: string) => analizarCsv(texto).registros.map((r) => r.campos);

describe('decodificar', () => {
  const bytes = (texto: string) => new TextEncoder().encode(texto);

  it('lee UTF-8 sin BOM con tildes y eñes', () => {
    expect(decodificar(bytes('Gestión jurídica, año'))).toBe('Gestión jurídica, año');
  });

  it('quita el BOM de UTF-8', () => {
    const conBom = new Uint8Array([0xef, 0xbb, 0xbf, ...bytes('codigo')]);
    expect(decodificar(conBom)).toBe('codigo');
  });

  it('rechaza Windows-1252 (el «CSV» por defecto de Excel) y dice cómo guardarlo', () => {
    const ansi = new Uint8Array([0x47, 0x65, 0x73, 0x74, 0x69, 0xf3, 0x6e]); // «Gestión» en Windows-1252
    expect(() => decodificar(ansi)).toThrow(CodificacionInvalidaError);
    expect(() => decodificar(ansi)).toThrow(/CSV UTF-8/);
  });

  it('rechaza UTF-16 (Excel «Texto Unicode») con un mensaje propio', () => {
    expect(() => decodificar(new Uint8Array([0xff, 0xfe, 0x63, 0x00]))).toThrow(/UTF-16/);
  });

  it('rechaza un archivo binario (un .xlsx renombrado)', () => {
    expect(() => decodificar(bytes('PK\u0003\u0004\u0000\u0000'))).toThrow(/binario/);
  });
});

describe('detectarSeparador', () => {
  it.each([
    ['coma', 'codigo,nombre,codigo_padre\n', ','],
    ['punto y coma (Excel en español)', 'codigo;nombre;codigo_padre\n', ';'],
    ['coma dentro de comillas no cuenta', '"a,b,c";nombre;padre\n', ';'],
    ['salta líneas vacías antes de la cabecera', '\n\r\ncodigo;nombre;padre\n', ';'],
    ['sin salto final', 'codigo,nombre,padre', ','],
  ] as const)('%s', (_nombre, texto, esperado) => {
    expect(detectarSeparador(texto)).toBe(esperado);
  });

  it.each([
    ['sin separadores', 'codigo\n'],
    ['mezcla pareja', 'a,b;c\n'],
    ['archivo vacío', ''],
  ])('devuelve null: %s', (_nombre, texto) => {
    expect(detectarSeparador(texto)).toBeNull();
  });
});

describe('analizarCsv', () => {
  it('lee campos simples y numera las líneas desde 1', () => {
    const r = analizarCsv('codigo,nombre,padre\n100,Gestión,\n100.1,Obras,100\n');
    expect(r.errores).toEqual([]);
    expect(r.separador).toBe(',');
    expect(r.registros).toEqual([
      { linea: 1, campos: ['codigo', 'nombre', 'padre'] },
      { linea: 2, campos: ['100', 'Gestión', ''] },
      { linea: 3, campos: ['100.1', 'Obras', '100'] },
    ]);
  });

  it.each([
    ['LF', '\n'],
    ['CRLF', '\r\n'],
    ['CR', '\r'],
  ])('acepta saltos de línea %s, con y sin salto final', (_nombre, salto) => {
    const texto = ['a,b', '1,2', '3,4'].join(salto);
    expect(campos(texto)).toEqual([['a', 'b'], ['1', '2'], ['3', '4']]);
    expect(campos(texto + salto)).toEqual([['a', 'b'], ['1', '2'], ['3', '4']]);
  });

  it('quita un BOM que haya quedado pegado al primer campo', () => {
    expect(campos('﻿codigo,nombre\n1,2')[0]).toEqual(['codigo', 'nombre']);
  });

  it('lee punto y coma como separador cuando la cabecera lo usa, aunque haya comas en los datos', () => {
    expect(campos('codigo;nombre;padre\n100;Contratos, obras y más;\n')).toEqual([
      ['codigo', 'nombre', 'padre'],
      ['100', 'Contratos, obras y más', ''],
    ]);
  });

  it('lee campos entre comillas con el separador, comillas dobles y saltos de línea dentro', () => {
    const r = analizarCsv('codigo,nombre,padre\n100,"Obras, ""civiles""\ny más",\n200,Otra,\n');
    expect(r.errores).toEqual([]);
    expect(r.registros[1]).toEqual({ linea: 2, campos: ['100', 'Obras, "civiles"\ny más', ''] });
    // La línea del registro siguiente cuenta el salto que quedó dentro de las comillas.
    expect(r.registros[2].linea).toBe(4);
  });

  it('cuenta bien las líneas con CRLF dentro de comillas', () => {
    const r = analizarCsv('a,b\r\n"x\r\ny",2\r\n3,4\r\n');
    expect(r.registros.map((x) => x.linea)).toEqual([1, 2, 4]);
    expect(r.registros[1].campos[0]).toBe('x\r\ny');
  });

  it('omite las líneas vacías (también con saltos mezclados) pero no las que solo tienen separadores', () => {
    expect(campos('a,b\n\n1,2\n\r\n,\n3,4\n\n')).toEqual([['a', 'b'], ['1', '2'], ['', ''], ['3', '4']]);
  });

  it('conserva los campos vacíos al final de la línea y los espacios (limpiarlos es cosa de quien valida)', () => {
    expect(campos('a,b,c\n1, dos ,\n')[1]).toEqual(['1', ' dos ', '']);
    expect(campos('a,b,c\n1,,\n')[1]).toEqual(['1', '', '']);
  });

  it('un campo entre comillas vacío es un campo vacío', () => {
    expect(campos('a,b\n"",x\n')[1]).toEqual(['', 'x']);
  });

  it('informa unas comillas sin cerrar con la línea donde se abrieron y marca el resultado como truncado', () => {
    const r = analizarCsv('a,b\n1,"sin cerrar\n2,3\n');
    expect(r.truncado).toBe(true);
    expect(r.errores).toEqual([{ linea: 2, mensaje: expect.stringContaining('Comillas sin cerrar') }]);
  });

  it('informa comillas en medio de un campo sin comillas, con su línea, y sigue leyendo', () => {
    const r = analizarCsv('a,b\n1,Actas de "comité"\n2,ok\n');
    expect(r.errores).toHaveLength(2);
    expect(r.errores.every((e) => e.linea === 2)).toBe(true);
    expect(r.truncado).toBe(false);
    expect(r.registros).toHaveLength(3);
  });

  it('informa texto pegado después de cerrar las comillas', () => {
    const r = analizarCsv('a,b\n"uno"dos,3\n4,5\n');
    expect(r.errores).toEqual([{ linea: 2, mensaje: expect.stringContaining('después de cerrar las comillas') }]);
    expect(r.registros[1].campos).toEqual(['uno', '3']);
    expect(r.registros[2].campos).toEqual(['4', '5']);
  });

  it('un archivo vacío o sin separador reconocible da un error sin registros', () => {
    expect(analizarCsv('').errores).toEqual([{ linea: 1, mensaje: 'El archivo está vacío.' }]);
    expect(analizarCsv('   \n\n').errores[0].mensaje).toContain('vacío');
    const r = analizarCsv('codigo nombre padre\n1 2 3\n');
    expect(r.separador).toBeNull();
    expect(r.registros).toEqual([]);
    expect(r.errores[0].mensaje).toContain('separador');
  });
});
