import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LIMITES_CUADRO, validarCuadro, validarCuadroDesdeBytes } from './cuadro.js';

/** El CSV ficticio del repositorio: sirve de documentación y de prueba. */
const RUTA_EJEMPLO = fileURLToPath(new URL('../../../../../docs/ejemplos/cuadro-ejemplo.csv', import.meta.url));

const CABECERA = 'codigo,nombre,codigo_padre';
const csv = (...filas: string[]) => [CABECERA, ...filas].join('\n');
const mensajes = (texto: string) => validarCuadro(texto).errores.map((e) => `${e.linea}: ${e.mensaje}`);

describe('validarCuadro: el cuadro válido', () => {
  it('lee el CSV ficticio del repositorio (5 series y 10 subseries) sin errores ni avisos', () => {
    const r = validarCuadroDesdeBytes(readFileSync(RUTA_EJEMPLO));
    expect(r.errores).toEqual([]);
    expect(r.avisos).toEqual([]);
    expect(r.filas).toHaveLength(15);
    expect(r.filas.filter((f) => f.codigoPadre === null).map((f) => f.codigo)).toEqual(['100', '200', '300', '400', '500']);
    expect(r.filas.find((f) => f.codigo === '100.3')).toEqual({
      linea: 5,
      codigo: '100.3',
      nombre: 'Contratos de suministro',
      codigoPadre: '100',
    });
  });

  it('la subserie puede ir antes que su serie en el archivo', () => {
    const r = validarCuadro(csv('100.1,Obras,100', '100,Gestión,'));
    expect(r.errores).toEqual([]);
    expect(r.filas.map((f) => f.codigo)).toEqual(['100.1', '100']);
  });

  it('limpia espacios de los lados y repetidos, y deja las tildes compuestas', () => {
    const r = validarCuadro(csv('  100  ,  Gestión   contractual ,  ', '100.1,"Obras\ny  más",  100 '));
    expect(r.errores).toEqual([]);
    expect(r.filas[0]).toMatchObject({ codigo: '100', nombre: 'Gestión contractual', codigoPadre: null });
    expect(r.filas[1]).toMatchObject({ nombre: 'Obras y más', codigoPadre: '100' });
    const decompuesto = 'Gestión'; // «o» + tilde combinada
    expect(validarCuadro(csv(`100,${decompuesto},`)).filas[0].nombre).toBe('Gestión');
  });

  it('acepta punto y coma, cualquier orden de columnas, cabecera con tildes y mayúsculas, y líneas vacías', () => {
    const r = validarCuadro('Nombre;Código Padre;CÓDIGO\n\nGestión;;100\nObras;100;100.1\n;;\n');
    expect(r.errores).toEqual([]);
    expect(r.filas.map((f) => [f.codigo, f.nombre, f.codigoPadre])).toEqual([
      ['100', 'Gestión', null],
      ['100.1', 'Obras', '100'],
    ]);
  });

  it('acepta el BOM y los saltos CRLF que deja Excel', () => {
    const texto = '\uFEFFcodigo;nombre;codigo_padre\r\n100;Gestión;\r\n100.1;Obras;100\r\n';
    expect(validarCuadro(texto).errores).toEqual([]);
  });

  it('acepta un nombre con comas y comillas bien escritas', () => {
    const r = validarCuadro(csv('100,"Contratos, convenios y ""otros""",'));
    expect(r.errores).toEqual([]);
    expect(r.filas[0].nombre).toBe('Contratos, convenios y "otros"');
  });

  it('avisa de las columnas que ignora, sin que sea un error', () => {
    const r = validarCuadro('codigo,nombre,codigo_padre,observaciones\n100,Gestión,,algo\n');
    expect(r.errores).toEqual([]);
    expect(r.avisos).toEqual([expect.stringContaining('observaciones')]);
  });

  it('acepta filas con menos campos que la cabecera (el padre que falta es una serie) y campos de más vacíos', () => {
    const r = validarCuadro('codigo,nombre,codigo_padre\n100,Gestión\n200,Otra,,,\n');
    expect(r.errores).toEqual([]);
    expect(r.filas.map((f) => f.codigoPadre)).toEqual([null, null]);
  });
});

describe('validarCuadro: errores con línea', () => {
  it('código vacío', () => {
    expect(mensajes(csv(',Sin código,'))).toEqual(['2: El código está vacío.']);
  });

  it('nombre vacío (solo espacios incluido)', () => {
    expect(mensajes(csv('100,,', '200,   ,'))).toEqual([
      '2: El nombre está vacío (código 100).',
      '3: El nombre está vacío (código 200).',
    ]);
  });

  it('código repetido, con la línea de la primera aparición', () => {
    expect(mensajes(csv('100,Uno,', '200,Dos,', '100,Tres,'))).toEqual([
      '4: El código 100 está repetido (ya aparece en la línea 2).',
    ]);
  });

  it('código que solo difiere en mayúsculas', () => {
    const [error] = validarCuadro(csv('A1,Uno,', 'a1,Dos,')).errores;
    expect(error).toMatchObject({ linea: 3 });
    expect(error.mensaje).toContain('mayúsculas');
  });

  it.each([
    ['con espacios', '100 1'],
    ['con tilde', '1ó0'],
    ['con barra', '100/1'],
    ['que empieza por separador', '.100'],
    ['que termina en separador', '100.'],
    ['con separadores seguidos', '1..2'],
    ['con comillas', 'a"b'],
  ])('código inválido %s', (_nombre, codigo) => {
    const texto = `${CABECERA}\n"${codigo.replaceAll('"', '""')}",Nombre,`;
    const [error] = validarCuadro(texto).errores;
    expect(error.linea).toBe(2);
    expect(error.mensaje).toContain('solo admite letras, números');
  });

  it('código demasiado largo y nombre demasiado largo', () => {
    const largo = 'A'.repeat(LIMITES_CUADRO.codigoMaximo + 1);
    const nombreLargo = 'x'.repeat(LIMITES_CUADRO.nombreMaximo + 1);
    const errores = validarCuadro(csv(`${largo},Uno,`, `200,${nombreLargo},`)).errores;
    expect(errores.map((e) => e.linea)).toEqual([2, 3]);
    expect(errores[0].mensaje).toContain(`el máximo es ${LIMITES_CUADRO.codigoMaximo}`);
    expect(errores[1].mensaje).toContain(`el máximo es ${LIMITES_CUADRO.nombreMaximo}`);
  });

  it('caracteres de control en el nombre', () => {
    const [error] = validarCuadro(csv('100,Gestión\u0007,')).errores;
    expect(error).toMatchObject({ linea: 2 });
    expect(error.mensaje).toContain('caracteres de control');
  });

  it('padre que no existe en el archivo, con una pista si solo cambia la mayúscula', () => {
    expect(mensajes(csv('100,Gestión,', '100.1,Obras,999'))).toEqual([
      expect.stringContaining('3: El padre «999» de 100.1 no está en el archivo'),
    ]);
    const [error] = validarCuadro(csv('A,Serie,', 'A.1,Sub,a')).errores;
    expect(error.mensaje).toContain('¿quiso decir A?');
  });

  it('padre que a su vez tiene padre (tercer nivel)', () => {
    const errores = validarCuadro(csv('100,Gestión,', '100.1,Obras,100', '100.1.1,Detalle,100.1')).errores;
    expect(errores).toEqual([
      { linea: 4, mensaje: expect.stringContaining('100.1 de 100.1.1 es una subserie') },
    ]);
  });

  it('una serie que es su propio padre', () => {
    expect(mensajes(csv('100,Gestión,100'))).toEqual(['2: 100 no puede ser su propio padre.']);
  });

  it('ciclo entre dos códigos, informado en las dos líneas', () => {
    const errores = validarCuadro(csv('A,Uno,B', 'B,Dos,A')).errores;
    expect(errores.map((e) => e.linea)).toEqual([2, 3]);
    expect(errores.every((e) => e.mensaje.startsWith('Ciclo:'))).toBe(true);
  });

  it('fila con campos de más con contenido (suele ser una coma sin comillas en un nombre)', () => {
    const [error] = validarCuadro(csv('100,Gestión,', '100.1,Contratos, convenios,100')).errores;
    expect(error).toMatchObject({ linea: 3 });
    expect(error.mensaje).toContain('4 campos y la cabecera 3');
  });

  it('informa todos los errores juntos y ordenados por línea', () => {
    const errores = validarCuadro(
      csv('100,Gestión,', ',Sin código,', '100,Repetida,', '200,,', '200.1,Obras,999', '300.1,Sub,300.1'),
    ).errores;
    expect(errores.map((e) => e.linea)).toEqual([3, 4, 5, 6, 7]);
  });

  describe('cabecera', () => {
    it('faltan columnas', () => {
      const [error] = validarCuadro('codigo,nombre\n100,Gestión\n').errores;
      expect(error).toMatchObject({ linea: 1 });
      expect(error.mensaje).toContain('Faltan columnas en la cabecera: codigo_padre');
    });

    it('columna repetida', () => {
      const errores = validarCuadro('codigo,nombre,codigo,codigo_padre\n100,Gestión,100,\n').errores;
      expect(errores[0].mensaje).toContain('«codigo» está repetida');
    });

    it('separador irreconocible, archivo vacío y sin filas', () => {
      expect(validarCuadro('codigo nombre\n1 2').errores[0].mensaje).toContain('separador');
      expect(validarCuadro('').errores[0].mensaje).toContain('vacío');
      expect(validarCuadro(`${CABECERA}\n`).errores).toEqual([
        { linea: null, mensaje: expect.stringContaining('no tiene filas') },
      ]);
    });
  });

  it('comillas sin cerrar: informa solo eso, sin errores en cascada', () => {
    const errores = validarCuadro(csv('100,"Gestión,', '200,Otra,')).errores;
    expect(errores).toEqual([{ linea: 2, mensaje: expect.stringContaining('Comillas sin cerrar') }]);
  });

  it('más filas que el máximo se informa una sola vez', () => {
    const filas = Array.from({ length: LIMITES_CUADRO.filasMaximas + 5 }, (_, i) => `C${i},Nombre ${i},`);
    const errores = validarCuadro(csv(...filas)).errores;
    expect(errores).toHaveLength(1);
    expect(errores[0].mensaje).toContain(`${LIMITES_CUADRO.filasMaximas} filas`);
  });
});

describe('validarCuadroDesdeBytes', () => {
  it('traduce un archivo en ANSI a un error con instrucciones, sin lanzar', () => {
    const ansi = new Uint8Array([...new TextEncoder().encode(`${CABECERA}\n100,Gesti`), 0xf3, ...new TextEncoder().encode('n,\n')]);
    const r = validarCuadroDesdeBytes(ansi);
    expect(r.filas).toEqual([]);
    expect(r.errores).toEqual([{ linea: null, mensaje: expect.stringContaining('CSV UTF-8') }]);
  });

  it('rechaza un archivo que pasa del tamaño máximo', () => {
    const r = validarCuadroDesdeBytes(new Uint8Array(LIMITES_CUADRO.bytesMaximos + 1).fill(97));
    expect(r.errores[0].mensaje).toContain('máximo');
  });
});
