import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
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
  /**
   * La clave actual la fijó un administrador (restablecimiento, ADR-011): hasta que la persona la cambie, la API
   * solo le deja ver quién es, cerrar sesión y cambiar la clave.
   */
  debeCambiarClave: boolean('debe_cambiar_clave').notNull().default(false),
  creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
});

/** Cuadro de clasificación documental provisional: series y subseries. */
export const seriesCcd = pgTable('series_ccd', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  codigo: text('codigo').notNull().unique(),
  nombre: text('nombre').notNull(),
  padreId: integer('padre_id').references((): AnyPgColumn => seriesCcd.id),
});

/** Columna `tsvector` de la búsqueda por texto completo. Solo se escribe con SQL (ver `actualizarBusqueda`). */
const tsvector = customType<{ data: string; driverData: string }>({ dataType: () => 'tsvector' });

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
    /**
     * Título (peso A), expediente (B) y texto de la versión vigente (C), todo normalizado (sin tildes)
     * y con la configuración `spanish`. La mantiene el servicio dentro de cada transacción que cambia
     * el documento (ADR-007).
     */
    busqueda: tsvector('busqueda'),
  },
  (tabla) => [
    index('documentos_serie_idx').on(tabla.serieId),
    index('documentos_expediente_idx').on(tabla.expediente),
    index('documentos_busqueda_idx').using('gin', tabla.busqueda),
  ],
);

/** Columna `bytea`, que Drizzle no trae: se lee y se escribe como Buffer. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

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
    /**
     * `ok`: se extrajo la capa de texto del PDF y hay firma de similitud. `sin_texto`: no tiene texto
     * suficiente (escaneado sin OCR, PDF dañado, casi vacío) y solo se verifica por huella exacta.
     * Las filas anteriores a la migración 0005 quedan en `sin_texto`.
     */
    textoEstado: text('texto_estado').notNull().default('sin_texto'),
    /** Texto normalizado (minúsculas, sin tildes ni signos). Alimenta la búsqueda por contenido (#13). */
    textoNormalizado: text('texto_normalizado'),
    /** Firma de similitud (MinHash, 1 KB). Ver ADR-006. */
    firma: bytea('firma'),
    /** Si esta versión restaura una anterior, el número de la versión de la que viene (mismo documento). */
    restauradaDe: integer('restaurada_de'),
    autorId: integer('autor_id')
      .notNull()
      .references(() => usuarios.id),
    creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (tabla) => [
    unique('versiones_documento_numero_uq').on(tabla.documentoId, tabla.numero),
    // La huella es única por documento solo entre versiones con contenido nuevo. Una restauración
    // repite a propósito la huella de la versión que restaura, por eso queda fuera del índice.
    uniqueIndex('versiones_documento_sha256_uq')
      .on(tabla.documentoId, tabla.sha256)
      .where(sql`${tabla.restauradaDe} is null`),
    // La versión restaurada debe existir en el mismo documento y ser anterior.
    foreignKey({
      name: 'versiones_restaurada_de_fk',
      columns: [tabla.documentoId, tabla.restauradaDe],
      foreignColumns: [tabla.documentoId, tabla.numero],
    }),
    check('versiones_texto_estado_ck', sql`${tabla.textoEstado} in ('ok', 'sin_texto')`),
    // Con texto hay texto y firma; sin texto no hay ninguno de los dos.
    check(
      'versiones_texto_coherente_ck',
      sql`(${tabla.textoEstado} = 'ok') = (${tabla.textoNormalizado} is not null and ${tabla.firma} is not null)`,
    ),
    check('versiones_restaurada_anterior_ck', sql`${tabla.restauradaDe} is null or ${tabla.restauradaDe} < ${tabla.numero}`),
    // Para avisar si otro documento ya tiene el mismo archivo.
    index('versiones_sha256_idx').on(tabla.sha256),
  ],
);

/**
 * Intentos de ingreso recientes, para limitarlos por usuario y por IP (ADR-009). Se guardan en la base y
 * no en la memoria del proceso porque Cloud Run puede tener varias instancias: un contador en memoria
 * dejaría que cada instancia concediera sus propios intentos. Un ingreso correcto borra los del usuario.
 */
export const intentosIngreso = pgTable(
  'intentos_ingreso',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    /** Lo escrito en el campo usuario, en minúsculas y truncado; existiera o no. */
    usuario: text('usuario').notNull(),
    ip: text('ip').notNull(),
    creadoEn: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (tabla) => [
    index('intentos_ingreso_usuario_idx').on(tabla.usuario, tabla.creadoEn),
    index('intentos_ingreso_ip_idx').on(tabla.ip, tabla.creadoEn),
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

/**
 * Sesiones de ingreso (ADR-003). El token que viaja en la cookie nunca se guarda:
 * aquí queda solo su SHA-256, así que quien lea la base no puede usar las sesiones.
 */
export const sesiones = pgTable(
  'sesiones',
  {
    /** SHA-256 (hex) del token de la cookie. */
    id: text('id').primaryKey(),
    usuarioId: integer('usuario_id')
      .notNull()
      .references(() => usuarios.id),
    creadaEn: timestamp('creada_en', { withTimezone: true }).notNull().defaultNow(),
    ultimoUso: timestamp('ultimo_uso', { withTimezone: true }).notNull().defaultNow(),
    /** Vence por inactividad; se renueva al usarla. */
    venceEn: timestamp('vence_en', { withTimezone: true }).notNull(),
  },
  (tabla) => [index('sesiones_usuario_idx').on(tabla.usuarioId)],
);
