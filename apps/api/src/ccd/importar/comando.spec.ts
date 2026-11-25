import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIMITES_CUADRO } from './cuadro.js';
import { prepararImportacion, textoDeArchivoInvalido } from './comando.js';

const RUTA_EJEMPLO = fileURLToPath(new URL('../../../../../docs/ejemplos/cuadro-ejemplo.csv', import.meta.url));

describe('prepararImportacion (argumentos y archivo, sin base de datos)', () => {
  let carpeta: string;
  beforeAll(() => {
    carpeta = mkdtempSync(join(tmpdir(), 'faro-ccd-'));
  });
  afterAll(() => {
    rmSync(carpeta, { recursive: true, force: true });
  });

  const escribir = (nombre: string, contenido: string | Uint8Array): string => {
    writeFileSync(join(carpeta, nombre), contenido);
    return nombre;
  };

  it('sin --aplicar la solicitud es de solo mostrar; trae la huella del archivo y su nombre sin carpetas', () => {
    const r = prepararImportacion([RUTA_EJEMPLO], carpeta);
    expect(r.tipo).toBe('listo');
    if (r.tipo !== 'listo') return;
    expect(r.solicitud).toMatchObject({ aplicar: false, eliminarAusentes: false });
    expect(r.solicitud.filas).toHaveLength(15);
    expect(r.solicitud.origen.archivo).toBe('cuadro-ejemplo.csv');
    expect(r.solicitud.origen.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('--aplicar y --eliminar-ausentes se leen, en cualquier orden respecto al archivo', () => {
    const nombre = escribir('a.csv', 'codigo,nombre,codigo_padre\n100,Gestión,\n');
    for (const argv of [[nombre, '--aplicar', '--eliminar-ausentes'], ['--eliminar-ausentes', '--aplicar', nombre]]) {
      const r = prepararImportacion(argv, carpeta);
      expect(r).toMatchObject({ tipo: 'listo', solicitud: { aplicar: true, eliminarAusentes: true } });
    }
  });

  it('las rutas relativas se resuelven contra la carpeta base (INIT_CWD con npm run)', () => {
    mkdirSync(join(carpeta, 'sub'), { recursive: true });
    writeFileSync(join(carpeta, 'sub', 'b.csv'), 'codigo,nombre,codigo_padre\n100,Gestión,\n');
    expect(prepararImportacion([join('sub', 'b.csv')], carpeta).tipo).toBe('listo');
    expect(prepararImportacion([join('sub', 'b.csv')], join(carpeta, 'sub')).tipo).toBe('uso');
  });

  it('la misma huella para el mismo contenido y distinta para otro', () => {
    const contenido = 'codigo,nombre,codigo_padre\n100,Gestión,\n';
    const huella = (nombre: string) => {
      const r = prepararImportacion([nombre], carpeta);
      return r.tipo === 'listo' ? r.solicitud.origen.sha256 : null;
    };
    expect(huella(escribir('c1.csv', contenido))).toBe(huella(escribir('c2.csv', contenido)));
    expect(huella(escribir('c3.csv', `${contenido}200,Otra,\n`))).not.toBe(huella('c1.csv'));
  });

  it.each([
    ['sin argumentos', []],
    ['dos archivos', ['a.csv', 'b.csv']],
    ['una opción que no existe', ['a.csv', '--borrar-todo']],
  ])('uso incorrecto: %s', (_nombre, argv) => {
    const r = prepararImportacion(argv, carpeta);
    expect(r.tipo).toBe('uso');
  });

  it('un archivo que no existe es un error de uso con la ruta completa', () => {
    const r = prepararImportacion(['no-existe.csv'], carpeta);
    expect(r).toMatchObject({ tipo: 'uso', mensaje: expect.stringContaining('No encuentro el archivo') });
  });

  it('--ayuda y -h piden la ayuda', () => {
    expect(prepararImportacion(['--ayuda'], carpeta).tipo).toBe('ayuda');
    expect(prepararImportacion(['-h'], carpeta).tipo).toBe('ayuda');
  });

  it('un archivo inválido devuelve todos sus errores y ninguna solicitud', () => {
    const nombre = escribir('malo.csv', 'codigo,nombre,codigo_padre\n,Sin código,\n100,,\n100.1,Obras,999\n');
    const r = prepararImportacion([nombre, '--aplicar'], carpeta);
    expect(r.tipo).toBe('invalido');
    if (r.tipo !== 'invalido') return;
    expect(r.errores.map((e) => e.linea)).toEqual([2, 3, 4]);
    const texto = textoDeArchivoInvalido(r.archivo, r.errores);
    expect(texto).toContain('malo.csv no es válido (3 problemas). No se escribió nada.');
    expect(texto).toContain('línea 2: El código está vacío.');
  });

  it('un archivo en ANSI (Excel) se rechaza con la instrucción de guardarlo como UTF-8', () => {
    const ansi = new Uint8Array([...new TextEncoder().encode('codigo,nombre,codigo_padre\n100,Gesti'), 0xf3, 0x6e, 0x2c, 0x0a]);
    const r = prepararImportacion([escribir('ansi.csv', ansi)], carpeta);
    expect(r).toMatchObject({ tipo: 'invalido', errores: [{ linea: null, mensaje: expect.stringContaining('CSV UTF-8') }] });
  });

  it('un archivo enorme se rechaza sin leerlo entero', () => {
    const r = prepararImportacion([escribir('enorme.csv', new Uint8Array(LIMITES_CUADRO.bytesMaximos + 1).fill(97))], carpeta);
    expect(r.tipo).toBe('invalido');
  });

  it('los avisos (columnas que se ignoran) acompañan a una solicitud válida', () => {
    const nombre = escribir('extra.csv', 'codigo;nombre;codigo_padre;nota\n100;Gestión;;x\n');
    const r = prepararImportacion([nombre], carpeta);
    expect(r).toMatchObject({ tipo: 'listo', avisos: [expect.stringContaining('nota')] });
  });
});
