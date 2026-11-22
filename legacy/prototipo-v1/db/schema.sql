CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY,
  usuario TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  rol TEXT NOT NULL CHECK (rol IN ('administrador', 'editor', 'consulta')),
  clave_hash TEXT NOT NULL
);

-- Cuadro de clasificación documental provisional: series y subseries.
CREATE TABLE IF NOT EXISTS series_ccd (
  id INTEGER PRIMARY KEY,
  codigo TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  padre_id INTEGER REFERENCES series_ccd (id)
);

CREATE TABLE IF NOT EXISTS documentos (
  id INTEGER PRIMARY KEY,
  titulo TEXT NOT NULL,
  expediente TEXT NOT NULL,
  serie_id INTEGER NOT NULL REFERENCES series_ccd (id),
  fecha_documento TEXT NOT NULL,
  creado_por INTEGER NOT NULL REFERENCES usuarios (id),
  creado_en TEXT NOT NULL
);

-- La huella es única: un mismo archivo no puede cargarse dos veces.
CREATE TABLE IF NOT EXISTS versiones (
  id INTEGER PRIMARY KEY,
  documento_id INTEGER NOT NULL REFERENCES documentos (id),
  numero INTEGER NOT NULL,
  archivo TEXT NOT NULL,
  nombre_original TEXT NOT NULL,
  sha256 TEXT NOT NULL UNIQUE,
  tamano INTEGER NOT NULL,
  motivo TEXT NOT NULL,
  autor_id INTEGER NOT NULL REFERENCES usuarios (id),
  creado_en TEXT NOT NULL,
  UNIQUE (documento_id, numero)
);

CREATE TABLE IF NOT EXISTS auditoria (
  id INTEGER PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios (id),
  accion TEXT NOT NULL,
  documento_id INTEGER REFERENCES documentos (id),
  detalle TEXT,
  creado_en TEXT NOT NULL
);
