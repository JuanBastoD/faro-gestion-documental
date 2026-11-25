#!/usr/bin/env bash
# Restaura un respaldo de Faro (hecho con respaldar.sh) en una base NUEVA, nunca sobre una existente.
# Guía completa y qué comprobar después: docs/respaldo.md.
#
# Uso:
#   export PGHOST=... PGPORT=... PGUSER=... PGPASSWORD=...     # el servidor donde se creará la base nueva
#   infra/respaldo/restaurar.sh <archivo.dump> <base_nueva>
#
# Qué hace: crea <base_nueva> (se niega si ya existe), restaura el respaldo adentro y muestra cuántas filas
# tiene cada tabla. Con RESTAURAR_COMPARAR_CON=<base> compara esos conteos con los de otra base (la original,
# si todavía existe). No toca ninguna otra base.
#
# Se niega a restaurar sobre: faro, postgres, template0, template1, cualquier nombre terminado en _test y
# la base de la que salió el respaldo (la dice su cabecera) o la que indique RESTAURAR_BASE_ORIGEN.
#
# Variables de entorno (ninguna credencial vive en el repositorio):
#   PGHOST (por defecto host.docker.internal), PGPORT (5432), PGUSER y PGPASSWORD (obligatorias), PGSSLMODE.
#                          La clave viaja por el entorno del contenedor, no como argumento ni en pantalla.
#   RESTAURAR_IMAGEN       Imagen con pg_restore y psql. Por defecto postgres:17-alpine FIJADA POR HUELLA (digest) en
#                          comun.sh. Debe ser de la misma versión mayor que el servidor de destino (y no más vieja
#                          que la de pg_dump).
#   RESTAURAR_BD_MANTENIMIENTO  Base a la que se conecta para crear la nueva. Por defecto postgres.
#   RESTAURAR_BASE_ORIGEN  Base de origen que también está prohibida como destino (opcional).
#   RESTAURAR_COMPARAR_CON Base con la que se comparan los conteos (opcional).
#
# Códigos de salida: 0 todo bien; 1 error o negativa; 2 la copia no tiene el disparador de auditoría;
# 3 los conteos no coinciden con la base de comparación.

set -euo pipefail
export MSYS_NO_PATHCONV=1

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=comun.sh
source "$AQUI/comun.sh"

IMAGEN="${RESTAURAR_IMAGEN:-$IMAGEN_POR_DEFECTO}"
MANTENIMIENTO="${RESTAURAR_BD_MANTENIMIENTO:-postgres}"
export RESTAURAR_IMAGEN="$IMAGEN"
export PGHOST="${PGHOST:-host.docker.internal}"
export PGPORT="${PGPORT:-5432}"
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-15}"

fallar() {
  echo "ERROR: $*" >&2
  exit 1
}
negarse() {
  echo "ME NIEGO: $*" >&2
  exit 1
}

[ $# -eq 2 ] || fallar "uso: infra/respaldo/restaurar.sh <archivo.dump> <base_nueva>"
ARCHIVO="$1"
BASE="$2"

# --- 1. Negativas por el nombre: antes de conectarse a nada ---------------------------------------------------
[[ "$BASE" =~ ^[a-z][a-z0-9_]{0,62}$ ]] || negarse "«${BASE}» no es un nombre válido: minúscula al inicio y solo minúsculas, números y guion bajo (máx. 63)."
case "$BASE" in
  faro | postgres | template0 | template1) negarse "«${BASE}» está protegida: este script solo restaura a una base nueva con otro nombre." ;;
  *_test) negarse "«${BASE}» termina en _test: son las bases de las pruebas automáticas, que vacían sus tablas." ;;
esac
if [ -n "${RESTAURAR_BASE_ORIGEN:-}" ] && [ "$BASE" = "$RESTAURAR_BASE_ORIGEN" ]; then
  negarse "«${BASE}» es la base de origen (RESTAURAR_BASE_ORIGEN): la copia va a otra base nueva."
fi

[ -f "$ARCHIVO" ] || fallar "no existe el archivo ${ARCHIVO}."
[ -s "$ARCHIVO" ] || fallar "el archivo ${ARCHIVO} está vacío."
[ -n "${PGUSER:-}" ] || fallar "falta PGUSER (usuario del servidor de destino)."
[ -n "${PGPASSWORD:-}" ] || fallar "falta PGPASSWORD (clave del servidor de destino)."
command -v docker >/dev/null 2>&1 || fallar "no se encontró docker."

docker_pg() {
  docker run --rm -i --add-host=host.docker.internal:host-gateway \
    -e PGHOST -e PGPORT -e PGUSER -e PGPASSWORD -e PGSSLMODE -e PGCONNECT_TIMEOUT \
    "$IMAGEN" "$@"
}

# --- 2. El archivo se puede leer y su base de origen no es el destino ---------------------------------------
lista="$(docker_pg pg_restore --list <"$ARCHIVO")" || fallar "pg_restore no puede leer ${ARCHIVO}. ¿Es un respaldo de respaldar.sh? ¿La imagen ${IMAGEN} es lo bastante nueva?"
origen="$(printf '%s\n' "$lista" | sed -n 's/^; *[Dd][Bb][Nn]ame: *//p' | head -n 1)"
if [ -n "$origen" ] && [ "$BASE" = "$origen" ]; then
  negarse "«${BASE}» es la base de la que salió el respaldo: elija otro nombre para la copia."
fi

# --- 3. Debe ser nueva: se niega si ya existe -----------------------------------------------------------------
existe="$(docker_pg psql --no-psqlrc -At -d "$MANTENIMIENTO" -c "SELECT 1 FROM pg_database WHERE datname = '${BASE}'")" \
  || fallar "no se pudo consultar el servidor (host ${PGHOST}, puerto ${PGPORT}). Revise PGHOST, PGPORT, PGUSER y PGPASSWORD."
[ -z "$existe" ] || negarse "la base «${BASE}» ya existe: este script nunca restaura sobre una base existente."

# --- 4. Crear y restaurar --------------------------------------------------------------------------------------
echo "Creando la base nueva «${BASE}» en ${PGHOST}:${PGPORT}..."
docker_pg psql --no-psqlrc -v ON_ERROR_STOP=1 -d "$MANTENIMIENTO" -c "CREATE DATABASE \"${BASE}\"" >/dev/null

echo "Restaurando ${ARCHIVO} (todo o nada: una sola transacción)..."
if ! docker_pg pg_restore --no-owner --no-privileges --single-transaction --exit-on-error --dbname="$BASE" <"$ARCHIVO"; then
  echo "ERROR: la restauración falló y se deshizo (la base «${BASE}» quedó creada y vacía)." >&2
  echo "Para repetir, bórrela primero: docker run --rm -e PGHOST -e PGPORT -e PGUSER -e PGPASSWORD ${IMAGEN} psql -d ${MANTENIMIENTO} -c 'DROP DATABASE \"${BASE}\"'" >&2
  exit 1
fi
echo "Restauración terminada."

# --- 5. Comprobaciones -----------------------------------------------------------------------------------------
estado=0

echo
echo "Disparador que protege la tabla auditoria:"
disparador="$(docker_pg psql --no-psqlrc -At -d "$BASE" -c "SELECT tgname || ' (' || CASE tgenabled WHEN 'O' THEN 'activo' ELSE 'DESACTIVADO' END || ')' FROM pg_trigger WHERE tgrelid = to_regclass('public.auditoria') AND NOT tgisinternal")"
if [ -n "$disparador" ]; then
  echo "  ${disparador}"
else
  echo "  AUSENTE: la copia no tiene ningún disparador en la tabla auditoria (o la tabla no existe)." >&2
  estado=2
fi

echo
echo "Filas por tabla en «${BASE}»:"
conteo_copia="$("$AQUI/contar.sh" "$BASE")"
printf '%s\n' "$conteo_copia"

if [ -n "${RESTAURAR_COMPARAR_CON:-}" ]; then
  echo
  echo "Comparación con «${RESTAURAR_COMPARAR_CON}»:"
  conteo_original="$("$AQUI/contar.sh" "$RESTAURAR_COMPARAR_CON")"
  if [ "$conteo_original" = "$conteo_copia" ]; then
    echo "  Los conteos de todas las tablas coinciden."
  else
    echo "  LOS CONTEOS DIFIEREN (original contra copia):" >&2
    diff <(printf '%s\n' "$conteo_original") <(printf '%s\n' "$conteo_copia") >&2 || true
    estado=3
  fi
fi

echo
if [ "$estado" -eq 0 ]; then
  echo "Listo. Falta comprobar la aplicación contra la copia: ver docs/respaldo.md, sección «Qué comprobar después»."
fi
exit "$estado"
