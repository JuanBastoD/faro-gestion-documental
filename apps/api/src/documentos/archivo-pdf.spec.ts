import {
  contenidoDisposicion,
  decodificarNombre,
  esPdf,
  limpiarNombre,
} from './archivo-pdf.js';

describe('esPdf', () => {
  it('acepta un contenido que empieza por %PDF-', () => {
    expect(esPdf(Buffer.from('%PDF-1.7\n...resto'))).toBe(true);
  });

  it.each([
    ['texto plano', 'hola mundo, esto no es un pdf'],
    ['una imagen PNG', '\x89PNG\r\n\x1a\n'],
    ['vacío', ''],
    ['solo la firma, sin contenido', '%PDF-'],
    ['la firma en minúsculas', '%pdf-1.4 contenido'],
    ['la firma con espacio delante', ' %PDF-1.4 contenido'],
  ])('rechaza %s', (_caso, contenido) => {
    expect(esPdf(Buffer.from(contenido, 'latin1'))).toBe(false);
  });
});

describe('decodificarNombre', () => {
  it('deshace el error de multer con nombres en UTF-8', () => {
    const comoLlega = Buffer.from('interventoría.pdf', 'utf8').toString('latin1');
    expect(comoLlega).not.toBe('interventoría.pdf');
    expect(decodificarNombre(comoLlega)).toBe('interventoría.pdf');
  });

  it('deja igual un nombre ASCII', () => {
    expect(decodificarNombre('acta-1.pdf')).toBe('acta-1.pdf');
  });

  it('deja igual un nombre que ya estaba bien y no es UTF-8 recodificable', () => {
    // "é" suelta en latin1 (0xE9) no es una secuencia UTF-8 válida: se conserva.
    expect(decodificarNombre('caf\u00e9.pdf')).toBe('caf\u00e9.pdf');
  });
});

describe('limpiarNombre', () => {
  it.each([
    ['acta de inicio.pdf', 'acta de inicio.pdf'],
    ['C:\\Users\\Ana\\acta.pdf', 'acta.pdf'],
    ['../../etc/passwd', 'passwd'],
    ['carpeta/sub/informe.pdf', 'informe.pdf'],
    ['con "comillas" y <signos>.pdf', 'con comillas y signos.pdf'],
    ['tab\tsalto\nlinea.pdf', 'tabsaltolinea.pdf'],
    ['   espacios    de   más .pdf', 'espacios de más .pdf'],
    ['.oculto.pdf', 'oculto.pdf'],
    ['', 'documento.pdf'],
    ['///', 'documento.pdf'],
    ['<>|:*?', 'documento.pdf'],
  ])('%j → %j', (entrada, esperado) => {
    expect(limpiarNombre(entrada)).toBe(esperado);
  });

  it('acorta un nombre largo conservando la extensión', () => {
    const resultado = limpiarNombre(`${'a'.repeat(300)}.pdf`);
    expect(resultado.length).toBe(150);
    expect(resultado.endsWith('.pdf')).toBe(true);
  });

  it('conserva las tildes y la eñe', () => {
    expect(limpiarNombre('Interventoría año 2026.pdf')).toBe('Interventoría año 2026.pdf');
  });
});

describe('contenidoDisposicion', () => {
  it('lleva un respaldo ASCII y el nombre real en UTF-8', () => {
    const cabecera = contenidoDisposicion('Interventoría.pdf');
    expect(cabecera).toBe(
      `attachment; filename="Interventor_a.pdf"; filename*=UTF-8''Interventor%C3%ADa.pdf`,
    );
  });

  it('no deja pasar comillas ni saltos que rompan la cabecera', () => {
    const cabecera = contenidoDisposicion('a"b\r\nSet-Cookie: x.pdf');
    expect(cabecera).not.toMatch(/[\r\n]/);
    expect(cabecera.split('"').length).toBe(3); // exactamente un par de comillas
  });

  it("codifica los caracteres que RFC 5987 no permite sin escapar, como la comilla simple", () => {
    expect(contenidoDisposicion("o'brien (1).pdf")).toContain("filename*=UTF-8''o%27brien%20%281%29.pdf");
  });
});
