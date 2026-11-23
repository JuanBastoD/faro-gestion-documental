#!/usr/bin/env bash
# Copia de seguridad de la base de datos de Faro con pg_dump (formato personalizado, -Fc).
# Guía completa, qué se respalda y qué no: docs/respaldo.md.
#
# Uso:
#   export RESPALDO_DATABASE_URL='postgresql://usuario:clave@host:puerto/base'   # NO la escribas en el repositorio
#   infra/respaldo/respaldar.sh
#
# Variables de entorno (ninguna credencial vive en el repositorio):
#   RESPALDO_DATABASE_URL  (obligatoria) Cadena de conexión de la base a respaldar. Es un secreto. La clave puede llevar
#                          caracteres especiales si van con codificación porcentual (%40 es @, %3A es :, %2F es /,
#                          %23 es #, %25 es %, %3F es ?). Admite sslmode, channel_binding, connect_timeout,
#                          application_name y options; cualquier otro parámetro se rechaza.
#                          El script la descompone y entrega al contenedor por variables de entorno (PGHOST, PGPORT,
#                          PGUSER, PGPASSWORD, PGDATABASE, PGSSLMODE...). LA CLAVE NO VIAJA COMO ARGUMENTO DE NINGÚN
#                          PROCESO (ni de docker ni de pg_dump): los argumentos de un proceso los puede leer cualquier
#                          usuario del equipo (/proc/<pid>/cmdline, ps); su entorno, solo su dueño. Tampoco se imprime.
#                          Si la cadena no se puede leer, el script se niega con un mensaje fijo que no repite nada de ella.
#   RESPALDO_DIR           Carpeta de salida. Por defecto ./respaldos (está en .gitignore).
#   RESPALDO_PREFIJO       Prefijo del nombre del archivo. Por defecto "faro" -> faro-AAAAMMDD-HHMMSS.dump (hora UTC).
#   RESPALDO_IMAGEN        Imagen que trae pg_dump. Por defecto, postgres:17-alpine FIJADA POR HUELLA (digest) en
#                          comun.sh: misma versión mayor que el Compose y el CI, y no la puede cambiar quien mueva la
#                          etiqueta. pg_dump se niega a respaldar un servidor MÁS NUEVO que él: si el servidor es
#                          PostgreSQL 18, pon aquí postgres:18-alpine@sha256:<huella> (también por huella).
#
# Termina con código distinto de cero si algo falla, y no deja archivos a medias.

set -euo pipefail

# Git Bash en Windows reescribe argumentos que parecen rutas; aquí estorba y en Linux no hace nada.
export MSYS_NO_PATHCONV=1

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=comun.sh
source "$AQUI/comun.sh"

IMAGEN="${RESPALDO_IMAGEN:-$IMAGEN_POR_DEFECTO}"
DIR="${RESPALDO_DIR:-./respaldos}"
PREFIJO="${RESPALDO_PREFIJO:-faro}"

fallar() {
  echo "ERROR: $*" >&2
  exit 1
}

[ -n "${RESPALDO_DATABASE_URL:-}" ] || fallar "falta RESPALDO_DATABASE_URL (la cadena de conexión de la base a respaldar). Ver docs/respaldo.md."
command -v docker >/dev/null 2>&1 || fallar "no se encontró docker. pg_dump se ejecuta con la imagen ${IMAGEN}."

# Descompone la cadena en variables PG* (exportadas). Si no se puede, se niega sin repetir nada de la cadena.
analizar_url_postgres "$RESPALDO_DATABASE_URL" || fallar "RESPALDO_DATABASE_URL no se puede usar: ${MOTIVO_URL} (el mensaje no repite la cadena). Ver docs/respaldo.md."
[ -n "${PGPASSWORD:-}" ] || fallar "RESPALDO_DATABASE_URL no trae clave: el respaldo no corre sin ella."

# La cadena y la clave nunca deben salir en un mensaje, ni siquiera dentro de un error de pg_dump.
ocultar() {
  local texto
  texto="$(cat)"
  texto="${texto//"$RESPALDO_DATABASE_URL"/[cadena-de-conexion-oculta]}"
  if [ "${#PGPASSWORD}" -ge 4 ]; then
    texto="${texto//"$PGPASSWORD"/[clave-oculta]}"
  fi
  if [ "${#CLAVE_CODIFICADA}" -ge 4 ]; then
    texto="${texto//"$CLAVE_CODIFICADA"/[clave-oculta]}"
  fi
  printf '%s\n' "$texto"
}

umask 077 # el respaldo contiene toda la base: solo lo lee quien lo creó
mkdir -p "$DIR"

nombre="${PREFIJO}-$(date -u +%Y%m%d-%H%M%S).dump"
destino="${DIR}/${nombre}"
parcial="${DIR}/.${nombre}.parcial"
errores="${DIR}/.${nombre}.errores"
lista="${DIR}/.${nombre}.lista"
limpiar() {
  rm -f "$parcial" "$errores" "$lista"
}
trap limpiar EXIT

[ ! -e "$destino" ] || fallar "ya existe ${destino}; espera un segundo y repite."

echo "Respaldando con pg_dump (imagen ${IMAGEN})..."
# -i y la redirección: el volcado sale por la salida estándar del contenedor y llega al archivo sin montar carpetas
# (funciona igual en Windows, macOS y Linux). --add-host permite llegar a una base en este mismo equipo
# (host.docker.internal) también en Linux.
# Las variables PG* se pasan SOLO POR NOMBRE (-e PGPASSWORD): docker toma el valor del entorno de este proceso, así que
# ni docker ni pg_dump llevan la clave en sus argumentos; pg_dump lee PGHOST, PGPORT, PGUSER, PGPASSWORD y PGDATABASE.
if ! docker run --rm -i --add-host=host.docker.internal:host-gateway \
  -e PGHOST -e PGPORT -e PGUSER -e PGPASSWORD -e PGDATABASE -e PGSSLMODE -e PGCHANNELBINDING \
  -e PGCONNECT_TIMEOUT -e PGAPPNAME -e PGOPTIONS \
  "$IMAGEN" pg_dump --format=custom --no-password \
  >"$parcial" 2>"$errores"; then
  echo "ERROR: pg_dump falló. Mensaje (con la conexión y la clave ocultadas):" >&2
  ocultar <"$errores" >&2
  if grep -q 'server version mismatch' "$errores"; then
    echo "PISTA: el servidor es más nuevo que pg_dump. Repite con RESPALDO_IMAGEN=postgres:<versión del servidor>-alpine@sha256:<huella>." >&2
  fi
  exit 1
fi

[ -s "$parcial" ] || fallar "el respaldo quedó vacío."

# El archivo tiene que poder leerse de verdad: pg_restore --list recorre su índice sin tocar ninguna base.
if ! docker run --rm -i "$IMAGEN" pg_restore --list <"$parcial" >"$lista" 2>"$errores"; then
  echo "ERROR: pg_restore no puede leer el respaldo recién creado:" >&2
  ocultar <"$errores" >&2
  exit 1
fi
entradas="$(grep -Ec '^[0-9]+; ' "$lista" || true)"
tablas="$(grep -E '^[0-9]+; [0-9]+ [0-9]+ TABLE ' "$lista" | grep -vc 'TABLE DATA' || true)"
[ "$entradas" -gt 0 ] || fallar "el respaldo no contiene ningún objeto de la base."
[ "$tablas" -gt 0 ] || fallar "el respaldo no contiene ninguna tabla."
origen="$(sed -n 's/^; *[Dd][Bb][Nn]ame: *//p' "$lista" | head -n 1)"
version="$(sed -n 's/^; *Dumped from database version: *//p' "$lista" | head -n 1)"

mv "$parcial" "$destino"

bytes="$(wc -c <"$destino" | tr -d ' ')"
if command -v sha256sum >/dev/null 2>&1; then
  huella="$(sha256sum "$destino" | cut -d' ' -f1)"
elif command -v shasum >/dev/null 2>&1; then
  huella="$(shasum -a 256 "$destino" | cut -d' ' -f1)"
else
  huella="(sin sha256sum ni shasum)"
fi

echo "Respaldo listo y verificado."
echo "  Archivo:   ${destino}"
echo "  Tamaño:    ${bytes} bytes"
echo "  SHA-256:   ${huella}"
echo "  Contenido: ${entradas} objetos listados, ${tablas} tablas (base de origen: ${origen:-?}; servidor PostgreSQL ${version:-?})"
