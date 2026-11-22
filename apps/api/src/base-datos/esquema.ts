import {
  bigint,
  boolean,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

/**
 * Esquema inicial: el modelo del prototipo v1 (usuarios, cuadro de clasificación,
 * documentos, versiones y auditoría) adaptado a PostgreSQL.
 * Cambios respecto al prototipo, según docs/PLAN_MEJORA.md:
 *  - fechas como timestamptz/date en lugar de texto;
 *  - la huella SHA-256 deja de ser única global y pasa a única por documento
 *    (permite restaurar una versión anterior; el aviso entre documentos se hace por consulta);
 *  - usuarios.activo, para desactivar sin borrar (HU-06).
 */

export const rolUsuario = pgEnum('rol_usuario', ['administrador', 'editor', 'consulta']);

export const usuarios = pgTable('usuarios', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  usuario: text('usuario').notNull().unique(),
  nombre: text('nombre').notNull(),
  rol: rolUsuario('rol').notNull(),
  claveHash: text('clave_hash').notNull(),
  activo: boolean('activo').notNull().default(true),
  creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
});

/** Cuadro de clasificación documental provisional: series y subseries. */
export const seriesCcd = pgTable('series_ccd', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  codigo: text('codigo').notNull().unique(),
  nombre: text('nombre').notNull(),
  padreId: integer('padre_id').references((): AnyPgColumn => seriesCcd.id),
});

export const documentos = pgTable(
  'documentos',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    titulo: text('titulo').notNull(),
    expediente: text('expediente').notNull(),
    serieId: integer('serie_id')
      .notNull()
      .references(() => seriesCcd.id),
    fechaDocumento: date('fecha_documento').notNull(),
    creadoPor: integer('creado_por')
      .notNull()
      .references(() => usuarios.id),
    creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (tabla) => [
    index('documentos_serie_idx').on(tabla.serieId),
    index('documentos_expediente_idx').on(tabla.expediente),
  ],
);

export const versiones = pgTable(
  'versiones',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    documentoId: integer('documento_id')
      .notNull()
      .references(() => documentos.id),
    numero: integer('numero').notNull(),
    /** Clave del objeto en el almacén de archivos (interfaz AlmacenArchivos). */
    archivo: text('archivo').notNull(),
    nombreOriginal: text('nombre_original').notNull(),
    sha256: text('sha256').notNull(),
    tamano: bigint('tamano', { mode: 'number' }).notNull(),
    motivo: text('motivo').notNull(),
    autorId: integer('autor_id')
      .notNull()
      .references(() => usuarios.id),
    creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (tabla) => [
    unique('versiones_documento_numero_uq').on(tabla.documentoId, tabla.numero),
    unique('versiones_documento_sha256_uq').on(tabla.documentoId, tabla.sha256),
    // Para avisar si otro documento ya tiene el mismo archivo.
    index('versiones_sha256_idx').on(tabla.sha256),
  ],
);

export const auditoria = pgTable(
  'auditoria',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    usuarioId: integer('usuario_id').references(() => usuarios.id),
    accion: text('accion').notNull(),
    documentoId: integer('documento_id').references(() => documentos.id),
    detalle: text('detalle'),
    creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (tabla) => [index('auditoria_creado_en_idx').on(tabla.creadoEn)],
);
