import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import {
  ObjetoNoEncontradoError,
  validarClave,
  validarPrefijo,
  type AlmacenArchivos,
  type ObjetoAlmacenado,
} from './almacen-archivos.js';

/** Guarda cada objeto como un archivo bajo una carpeta. Para desarrollo y pruebas sin Docker. */
export class AlmacenDisco implements AlmacenArchivos {
  private readonly raiz: string;

  constructor(raiz: string) {
    this.raiz = resolve(raiz);
  }

  private ruta(clave: string): string {
    validarClave(clave);
    const ruta = resolve(this.raiz, ...clave.split('/'));
    // Defensa adicional: aunque la clave ya se validó, la ruta final debe quedar dentro de la raíz.
    if (!ruta.startsWith(this.raiz + sep)) {
      throw new Error('La clave resuelve fuera del almacén');
    }
    return ruta;
  }

  async guardar(clave: string, datos: Buffer): Promise<void> {
    const destino = this.ruta(clave);
    await mkdir(dirname(destino), { recursive: true });
    // Se escribe en un archivo temporal y se renombra: nadie lee un archivo a medias.
    const temporal = `${destino}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporal, datos);
      await rename(temporal, destino);
    } catch (error) {
      await rm(temporal, { force: true });
      throw error;
    }
  }

  async leer(clave: string): Promise<Buffer> {
    try {
      return await readFile(this.ruta(clave));
    } catch (error) {
      if (esNoExiste(error)) throw new ObjetoNoEncontradoError(clave);
      throw error;
    }
  }

  async existe(clave: string): Promise<boolean> {
    try {
      return (await stat(this.ruta(clave))).isFile();
    } catch (error) {
      if (esNoExiste(error)) return false;
      throw error;
    }
  }

  async borrar(clave: string): Promise<void> {
    await rm(this.ruta(clave), { force: true });
  }

  async listar(prefijo: string): Promise<ObjetoAlmacenado[]> {
    validarPrefijo(prefijo);
    const encontrados: ObjetoAlmacenado[] = [];
    const recorrer = async (carpeta: string, relativa: string): Promise<void> => {
      let entradas;
      try {
        entradas = await readdir(carpeta, { withFileTypes: true });
      } catch (error) {
        if (esNoExiste(error)) return;
        throw error;
      }
      for (const entrada of entradas) {
        const clave = relativa === '' ? entrada.name : `${relativa}/${entrada.name}`;
        if (entrada.isDirectory()) {
          await recorrer(join(carpeta, entrada.name), clave);
        } else if (entrada.isFile() && !entrada.name.endsWith('.tmp') && clave.startsWith(prefijo)) {
          encontrados.push({
            clave,
            modificadoEn: (await stat(join(carpeta, entrada.name))).mtime,
          });
        }
      }
    };
    await recorrer(this.raiz, '');
    return encontrados.sort((a, b) => a.clave.localeCompare(b.clave));
  }
}

function esNoExiste(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT' || (error as NodeJS.ErrnoException)?.code === 'ENOTDIR';
}
