import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3';
import {
  ClaveInvalidaError,
  ObjetoNoEncontradoError,
  type AlmacenArchivos,
} from '../src/almacen/almacen-archivos.js';
import { AlmacenDisco } from '../src/almacen/almacen-disco.js';
import { AlmacenS3 } from '../src/almacen/almacen-s3.js';
import { cargarEnvLocal } from '../src/config/cargar-env.js';

cargarEnvLocal();

const opcionesS3 = () => ({
  endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
  region: process.env.S3_REGION ?? 'us-east-1',
  bucket: process.env.S3_BUCKET ?? 'faro-documentos',
  accessKey: process.env.S3_ACCESS_KEY ?? '',
  secretKey: process.env.S3_SECRET_KEY ?? '',
});

/** ¿Responde el almacén S3 de `npm run infra:up`? En CI siempre debe responder. */
async function s3Disponible(): Promise<boolean> {
  const o = opcionesS3();
  if (!o.accessKey || !o.secretKey) return false;
  const cliente = new S3Client({
    endpoint: o.endpoint,
    region: o.region,
    forcePathStyle: true,
    credentials: { accessKeyId: o.accessKey, secretAccessKey: o.secretKey },
    maxAttempts: 1,
    requestHandler: { requestTimeout: 3000, connectionTimeout: 2000 },
  });
  try {
    await cliente.send(new HeadBucketCommand({ Bucket: o.bucket }));
    return true;
  } catch {
    return false;
  } finally {
    cliente.destroy();
  }
}

const hayS3 = await s3Disponible();
if (!hayS3 && process.env.CI) {
  throw new Error(
    'En CI el almacén S3 debe estar disponible (variables S3_* y bucket creado). Las pruebas del adaptador S3 no pueden omitirse.',
  );
}

interface Caso {
  nombre: string;
  omitir: boolean;
  crear: () => Promise<{ almacen: AlmacenArchivos; limpiar: () => Promise<void> }>;
}

const casos: Caso[] = [
  {
    nombre: 'AlmacenDisco',
    omitir: false,
    crear: async () => {
      const carpeta = await mkdtemp(join(tmpdir(), 'faro-contrato-'));
      return { almacen: new AlmacenDisco(carpeta), limpiar: () => rm(carpeta, { recursive: true, force: true }) };
    },
  },
  {
    nombre: 'AlmacenS3 (RustFS)',
    omitir: !hayS3,
    crear: async () => {
      const almacen = new AlmacenS3(opcionesS3());
      // Cada ejecución usa su propio prefijo dentro del bucket y lo borra al terminar.
      return { almacen, limpiar: async () => almacen.cerrar() };
    },
  },
];

describe.each(casos)('Contrato de AlmacenArchivos: $nombre', ({ omitir, crear }) => {
  let almacen: AlmacenArchivos;
  let limpiar: () => Promise<void>;
  // Un prefijo único por ejecución evita choques entre ejecuciones y entre adaptadores.
  const raiz = `pruebas-${randomUUID().slice(0, 8)}`;
  const clave = (nombre: string) => `${raiz}/${nombre}`;
  const creadas: string[] = [];

  beforeAll(async () => {
    if (omitir) return;
    ({ almacen, limpiar } = await crear());
  });

  afterAll(async () => {
    if (omitir) return;
    for (const c of creadas) await almacen.borrar(c);
    await limpiar();
  });

  const guardar = async (nombre: string, datos: Buffer) => {
    creadas.push(clave(nombre));
    await almacen.guardar(clave(nombre), datos, 'application/pdf');
  };

  it.skipIf(omitir)('guarda y lee los mismos bytes, también binarios', async () => {
    const datos = randomBytes(1024 * 1024);
    await guardar('binario.pdf', datos);
    const leido = await almacen.leer(clave('binario.pdf'));
    expect(leido.equals(datos)).toBe(true);
  });

  it.skipIf(omitir)('guarda un archivo vacío', async () => {
    await guardar('vacio.pdf', Buffer.alloc(0));
    expect((await almacen.leer(clave('vacio.pdf'))).length).toBe(0);
  });

  it.skipIf(omitir)('existe responde true solo si el objeto está', async () => {
    await guardar('presente.pdf', Buffer.from('x'));
    expect(await almacen.existe(clave('presente.pdf'))).toBe(true);
    expect(await almacen.existe(clave('ausente.pdf'))).toBe(false);
  });

  it.skipIf(omitir)('leer un objeto inexistente lanza ObjetoNoEncontradoError', async () => {
    await expect(almacen.leer(clave('no-existe.pdf'))).rejects.toBeInstanceOf(ObjetoNoEncontradoError);
  });

  it.skipIf(omitir)('guardar en una clave existente la reemplaza', async () => {
    await guardar('reemplazo.pdf', Buffer.from('uno'));
    await guardar('reemplazo.pdf', Buffer.from('dos'));
    expect((await almacen.leer(clave('reemplazo.pdf'))).toString()).toBe('dos');
  });

  it.skipIf(omitir)('borrar quita el objeto y es idempotente', async () => {
    await guardar('borrable.pdf', Buffer.from('x'));
    await almacen.borrar(clave('borrable.pdf'));
    expect(await almacen.existe(clave('borrable.pdf'))).toBe(false);
    await expect(almacen.borrar(clave('borrable.pdf'))).resolves.toBeUndefined();
    await expect(almacen.borrar(clave('nunca-existio.pdf'))).resolves.toBeUndefined();
  });

  it.skipIf(omitir)('listar devuelve solo lo que empieza por el prefijo, con su fecha', async () => {
    await guardar('lista/a.pdf', Buffer.from('a'));
    await guardar('lista/b.pdf', Buffer.from('b'));
    await guardar('otra/c.pdf', Buffer.from('c'));
    const listados = await almacen.listar(`${raiz}/lista/`);
    expect(listados.map((o) => o.clave)).toEqual([clave('lista/a.pdf'), clave('lista/b.pdf')]);
    expect(listados.every((o) => o.modificadoEn instanceof Date && !Number.isNaN(o.modificadoEn.getTime()))).toBe(true);
    expect(Math.abs(Date.now() - listados[0].modificadoEn.getTime())).toBeLessThan(5 * 60_000);
  });

  it.skipIf(omitir)('listar un prefijo sin objetos devuelve una lista vacía', async () => {
    expect(await almacen.listar(`${raiz}/no-hay/`)).toEqual([]);
  });

  it.skipIf(omitir)('rechaza claves que podrían salirse del almacén', async () => {
    for (const mala of ['../fuera.pdf', '/abs.pdf', 'a//b.pdf', 'Mayusculas.pdf']) {
      await expect(almacen.guardar(mala, Buffer.from('x'), 'application/pdf')).rejects.toBeInstanceOf(ClaveInvalidaError);
      await expect(almacen.leer(mala)).rejects.toBeInstanceOf(ClaveInvalidaError);
      await expect(almacen.existe(mala)).rejects.toBeInstanceOf(ClaveInvalidaError);
      await expect(almacen.borrar(mala)).rejects.toBeInstanceOf(ClaveInvalidaError);
    }
  });
});
