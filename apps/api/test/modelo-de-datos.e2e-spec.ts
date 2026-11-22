/**
 * Compara docs/modelo-de-datos.md con la base de datos migrada de verdad, para que el documento no
 * quede desactualizado sin que el CI falle. No comprueba las descripciones ni el diagrama Mermaid.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ACCION } from '../src/auditoria/acciones.js';
import { crearApp, type AppDePrueba } from './ayudas.js';

const RUTA_DOCUMENTO = fileURLToPath(new URL('../../../docs/modelo-de-datos.md', import.meta.url));
const documento = readFileSync(RUTA_DOCUMENTO, 'utf8').replace(/\r\n/g, '\n');

type Fila = Record<string, string>;

/** Filas de la primera tabla de Markdown que sigue a un encabezado, con las celdas sin comillas invertidas. */
function tablaBajo(encabezado: RegExp): Fila[] {
  const lineas = documento.split('\n');
  const inicio = lineas.findIndex((l) => encabezado.test(l));
  if (inicio < 0) throw new Error(`No encontré el encabezado ${encabezado} en docs/modelo-de-datos.md`);
  const celdas = (l: string) =>
    l
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((c) => c.trim().replace(/`/g, ''));
  let i = inicio + 1;
  while (i < lineas.length && !lineas[i].startsWith('|')) {
    if (lineas[i].startsWith('#')) throw new Error(`No hay tabla bajo ${encabezado}`);
    i++;
  }
  const columnas = celdas(lineas[i]);
  i += 2; // salta la línea de separación
  const filas: Fila[] = [];
  for (; i < lineas.length && lineas[i].startsWith('|'); i++) {
    const valores = celdas(lineas[i]);
    filas.push(Object.fromEntries(columnas.map((c, k) => [c, valores[k] ?? ''])));
  }
  return filas;
}

/** Las tablas del diccionario: un encabezado «### `nombre`» cada una, dentro de la sección 4. */
function tablasDocumentadas(): string[] {
  const seccion = documento.slice(documento.indexOf('## 4. Diccionario de datos'), documento.indexOf('## 5. '));
  return [...seccion.matchAll(/^### `(\w+)`$/gm)].map((m) => m[1]);
}

const ordenado = (xs: string[]) => [...xs].sort((a, b) => a.localeCompare(b));

describe('docs/modelo-de-datos.md coincide con la base de datos migrada', () => {
  let ctx: AppDePrueba;

  beforeAll(async () => {
    ctx = await crearApp();
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  const consultar = async <T>(texto: string): Promise<T[]> => (await ctx.pool.query(texto)).rows as T[];

  it('documenta exactamente las tablas que hay (ni una más, ni una menos)', async () => {
    const reales = (
      await consultar<{ table_name: string }>(
        `select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`,
      )
    ).map((f) => f.table_name);
    expect(ordenado(tablasDocumentadas())).toEqual(ordenado(reales));
    expect(reales.length).toBeGreaterThan(0);
  });

  describe('cada tabla del diccionario', () => {
    for (const tabla of tablasDocumentadas()) {
      describe(`\`${tabla}\``, () => {
        const diccionario = () => tablaBajo(new RegExp(`^### \`${tabla}\`$`));

        it('tiene las mismas columnas, con el mismo tipo y la misma nulabilidad', async () => {
          const reales = await consultar<{ column_name: string; data_type: string; udt_name: string; is_nullable: string }>(
            `select column_name, data_type, udt_name, is_nullable from information_schema.columns
              where table_schema = 'public' and table_name = '${tabla}' order by ordinal_position`,
          );
          const tipoReal = (c: { data_type: string; udt_name: string }) =>
            c.data_type === 'timestamp with time zone' ? 'timestamptz' : c.data_type === 'USER-DEFINED' ? c.udt_name : c.data_type;
          // Sin importar el orden: las columnas que agregan las migraciones quedan al final en la base.
          const porCampo = (a: { campo: string }, b: { campo: string }) => a.campo.localeCompare(b.campo);
          expect(
            diccionario()
              .map((f) => ({ campo: f.Campo, tipo: f.Tipo, nulo: f.Nulo }))
              .sort(porCampo),
          ).toEqual(
            reales
              .map((c) => ({ campo: c.column_name, tipo: tipoReal(c), nulo: c.is_nullable === 'YES' ? 'Sí' : 'No' }))
              .sort(porCampo),
          );
        });

        it('documenta bien la clave primaria, las foráneas y las únicas de una columna', async () => {
          const restricciones = await consultar<{ columna: string; tipo: string; destino: string | null }>(
            `select a.attname as columna, c.contype as tipo,
                    case when c.contype = 'f' then (select cl.relname || '.' || fa.attname
                         from pg_class cl join pg_attribute fa on fa.attrelid = cl.oid and fa.attnum = c.confkey[1]
                         where cl.oid = c.confrelid) end as destino
               from pg_constraint c
               join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
              where c.conrelid = 'public.${tabla}'::regclass
                and c.contype in ('p', 'u', 'f') and array_length(c.conkey, 1) = 1`,
          );
          const realesPorColumna = new Map<string, string[]>();
          for (const r of restricciones) {
            const marca = r.tipo === 'p' ? 'PK' : r.tipo === 'u' ? 'único' : `FK ${r.destino}`;
            realesPorColumna.set(r.columna, [...(realesPorColumna.get(r.columna) ?? []), marca]);
          }
          for (const fila of diccionario()) {
            // «FK compuesta» y «—» no dicen nada de una sola columna: se comparan solo las demás marcas.
            const documentadas = fila.Clave.split(',')
              .map((m) => m.trim())
              .filter((m) => m !== '—' && m !== 'FK compuesta');
            expect(ordenado(documentadas), `${tabla}.${fila.Campo}`).toEqual(ordenado(realesPorColumna.get(fila.Campo) ?? []));
          }
        });
      });
    }
  });

  it('las columnas marcadas «FK compuesta» forman parte de una clave foránea de varias columnas', async () => {
    const compuestas = await consultar<{ tabla: string; columna: string }>(
      `select c.conrelid::regclass::text as tabla, a.attname as columna
         from pg_constraint c
         join lateral unnest(c.conkey) as k(n) on true
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n
        where c.contype = 'f' and array_length(c.conkey, 1) > 1`,
    );
    for (const tabla of tablasDocumentadas()) {
      for (const fila of tablaBajo(new RegExp(`^### \`${tabla}\`$`))) {
        if (!fila.Clave.includes('FK compuesta')) continue;
        expect(compuestas, `${tabla}.${fila.Campo}`).toContainEqual({ tabla, columna: fila.Campo });
      }
    }
  });

  it('documenta las restricciones CHECK y las de varias columnas', async () => {
    const reales = (
      await consultar<{ conname: string }>(
        `select conname from pg_constraint
          where connamespace = 'public'::regnamespace
            and (contype = 'c' or (contype in ('u', 'f') and array_length(conkey, 1) > 1))`,
      )
    ).map((f) => f.conname);
    const documentadas = tablaBajo(/^## 5\. /).map((f) => f.Nombre);
    expect(ordenado(documentadas)).toEqual(ordenado(reales));
    // Y cada una está en la tabla que dice el documento.
    for (const fila of tablaBajo(/^## 5\. /)) {
      const [real] = await consultar<{ tabla: string }>(
        `select conrelid::regclass::text as tabla from pg_constraint where conname = '${fila.Nombre}'`,
      );
      expect(real.tabla, fila.Nombre).toBe(fila.Tabla);
    }
  });

  it('documenta los índices (sin los de claves primarias ni restricciones únicas)', async () => {
    const reales = await consultar<{ indexname: string; tablename: string }>(
      `select indexname, tablename from pg_indexes
        where schemaname = 'public'
          and indexname not in (select conname from pg_constraint
                                 where connamespace = 'public'::regnamespace and contype in ('p', 'u'))`,
    );
    const documentados = tablaBajo(/^## 6\. /);
    expect(ordenado(documentados.map((f) => f.Índice))).toEqual(ordenado(reales.map((r) => r.indexname)));
    for (const fila of documentados) {
      expect(reales.find((r) => r.indexname === fila.Índice)?.tablename, fila.Índice).toBe(fila.Tabla);
    }
  });

  it('documenta los disparadores', async () => {
    const reales = await consultar<{ tgname: string; tabla: string }>(
      `select tgname, tgrelid::regclass::text as tabla from pg_trigger
        where not tgisinternal and tgrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace)`,
    );
    const documentados = tablaBajo(/^## 7\. /);
    expect(ordenado(documentados.map((f) => f.Disparador))).toEqual(ordenado(reales.map((r) => r.tgname)));
    for (const fila of documentados) {
      expect(reales.find((r) => r.tgname === fila.Disparador)?.tabla, fila.Disparador).toBe(fila.Tabla);
    }
  });

  it('documenta los valores del tipo rol_usuario', async () => {
    const reales = (
      await consultar<{ enumlabel: string }>(
        `select enumlabel from pg_enum where enumtypid = 'public.rol_usuario'::regtype order by enumsortorder`,
      )
    ).map((f) => f.enumlabel);
    const [fila] = tablaBajo(/^## 3\. /);
    expect(fila.Tipo).toBe('rol_usuario');
    expect(fila.Valores.split(',').map((v) => v.trim())).toEqual(reales);
    // El tipo enumerado es el único del esquema: si aparece otro, hay que documentarlo.
    const tipos = await consultar<{ typname: string }>(
      `select typname from pg_type where typtype = 'e' and typnamespace = 'public'::regnamespace`,
    );
    expect(tipos.map((t) => t.typname)).toEqual(['rol_usuario']);
  });

  it('documenta las acciones de auditoría que define el código', () => {
    const documentadas = tablaBajo(/^## 8\. /).map((f) => f.Valor);
    expect(ordenado(documentadas)).toEqual(ordenado(Object.values(ACCION)));
  });

  it('cada migración en apps/api/drizzle está en el historial del documento', async () => {
    const { readdirSync } = await import('node:fs');
    const carpeta = fileURLToPath(new URL('../drizzle/', import.meta.url));
    const archivos = readdirSync(carpeta)
      .filter((n) => n.endsWith('.sql'))
      .map((n) => n.replace(/\.sql$/, ''));
    expect(ordenado(tablaBajo(/^## 9\. /).map((f) => f.Migración))).toEqual(ordenado(archivos));
  });
});
