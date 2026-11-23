#!/usr/bin/env bash
# Cuenta las filas de cada tabla (esquemas public y drizzle) de una base de PostgreSQL.
# Sirve para comparar una base con su copia restaurada. Lo usa restaurar.sh; también se corre solo.
# Guía: docs/respaldo.md.
#
# Uso:
#   export PGUSER=... PGPASSWORD=...        # PGHOST (por defecto host.docker.internal) y PGPORT (por defecto 5432)
#   infra/respaldo/contar.sh <base>
#
# Variables de entorno: las estándar de libpq (PGHOST, PGPORT, PGUSER, PGPASSWORD, PGSSLMODE) y
#   RESTAURAR_IMAGEN  Imagen con psql. Por defecto postgres:17-alpine.
# Solo lee; no cambia nada. La clave viaja por el entorno del contenedor, no como argumento.

set -euo pipefail
export MSYS_NO_PATHCONV=1

IMAGEN="${RESTAURAR_IMAGEN:-postgres:17-alpine}"
export PGHOST="${PGHOST:-host.docker.internal}"
export PGPORT="${PGPORT:-5432}"
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-15}"

fallar() {
  echo "ERROR: $*" >&2
  exit 1
}

[ $# -eq 1 ] || fallar "uso: infra/respaldo/contar.sh <base>"
BASE="$1"
[[ "$BASE" =~ ^[a-z][a-z0-9_]{0,62}$ ]] || fallar "nombre de base no válido: use minúsculas, números y guion bajo."
[ -n "${PGUSER:-}" ] || fallar "falta PGUSER."
[ -n "${PGPASSWORD:-}" ] || fallar "falta PGPASSWORD."
command -v docker >/dev/null 2>&1 || fallar "no se encontró docker."

# Arma una consulta con un SELECT count(*) por tabla y la ejecuta (\gset guarda el texto, :consulta lo corre).
docker run --rm -i --add-host=host.docker.internal:host-gateway \
  -e PGHOST -e PGPORT -e PGUSER -e PGPASSWORD -e PGSSLMODE -e PGCONNECT_TIMEOUT \
  "$IMAGEN" psql --no-psqlrc -v ON_ERROR_STOP=1 -d "$BASE" <<'SQL'
SELECT coalesce(
  string_agg(
    format('SELECT %L AS tabla, count(*) AS filas FROM %I.%I', schemaname || '.' || tablename, schemaname, tablename),
    ' UNION ALL ' ORDER BY schemaname, tablename
  ),
  'SELECT NULL::text AS tabla, 0::bigint AS filas WHERE false'
) AS consulta
FROM pg_tables
WHERE schemaname IN ('public', 'drizzle')
\gset
:consulta ORDER BY 1;
SQL
