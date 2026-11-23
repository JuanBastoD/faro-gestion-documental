import type { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type pg from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { hashear } from '../src/auth/hash-clave.js';
import type { Rol } from '../src/auth/roles.js';
import { DB, POOL, type BaseDatos } from '../src/base-datos/base-datos.module.js';
import { migrar } from '../src/base-datos/migrar.js';
import { usuarios } from '../src/base-datos/esquema.js';

export const CLAVE_DE_PRUEBA = 'clave-de-prueba-123';

export interface AppDePrueba {
  app: INestApplication;
  pool: pg.Pool;
  db: BaseDatos;
}

/** Levanta la API completa contra la base de pruebas. `controladores` agrega rutas solo para la prueba. */
export async function crearApp(controladores: Type[] = []): Promise<AppDePrueba> {
  const modulo = await Test.createTestingModule({
    imports: [AppModule],
    controllers: controladores,
  }).compile();
  const app = modulo.createNestApplication();
  await app.init();
  const pool = app.get<pg.Pool>(POOL);
  const db = app.get<BaseDatos>(DB);
  await migrar(db);
  return { app, pool, db };
}

/** Deja todas las tablas vacías y reinicia los contadores. Solo para la base de pruebas. */
export async function limpiarTablas(pool: pg.Pool): Promise<void> {
  await pool.query(
    'truncate auditoria, sesiones, versiones, documentos, series_ccd, usuarios restart identity cascade',
  );
}

// Un solo hash para todas las pruebas: argon2 es lento a propósito.
let hashDePrueba: Promise<string> | undefined;

export async function crearUsuario(
  db: BaseDatos,
  datos: { usuario: string; rol: Rol; activo?: boolean },
): Promise<number> {
  hashDePrueba ??= hashear(CLAVE_DE_PRUEBA);
  const [fila] = await db
    .insert(usuarios)
    .values({
      usuario: datos.usuario,
      nombre: `Nombre de ${datos.usuario}`,
      rol: datos.rol,
      claveHash: await hashDePrueba,
      activo: datos.activo ?? true,
    })
    .returning({ id: usuarios.id });
  return fila.id;
}

/** Ingresa y devuelve el valor de la cabecera Cookie para las peticiones siguientes. */
export async function ingresar(
  app: INestApplication,
  usuario: string,
  clave = CLAVE_DE_PRUEBA,
): Promise<string> {
  const respuesta = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ usuario, clave })
    .expect(200);
  return cookieDe(respuesta);
}

export function cookieDe(respuesta: request.Response): string {
  const cabecera = respuesta.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = cabecera?.find((c) => c.startsWith('faro_sesion='));
  if (!cookie) throw new Error('La respuesta no trae la cookie faro_sesion');
  return cookie.split(';')[0];
}

export async function eventos(pool: pg.Pool, accion: string): Promise<
  Array<{ usuario_id: number | null; accion: string; detalle: string | null }>
> {
  const { rows } = await pool.query(
    'select usuario_id, accion, detalle from auditoria where accion = $1 order by id',
    [accion],
  );
  return rows;
}
