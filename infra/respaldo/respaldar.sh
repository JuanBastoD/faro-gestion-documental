#!/usr/bin/env bash
# Copia de seguridad de la base de datos de Faro con pg_dump (formato personalizado, -Fc).
# Guía completa, qué se respalda y qué no: docs/respaldo.md.
#
# Uso:
#   export RESPALDO_DATABASE_URL='postgresql://usuario:clave@host:puerto/base'   # NO la escribas en el repositorio
#   infra/respaldo/respaldar.sh
#
# Variables de entorno (ninguna credencial vive en el repositorio):
#   RESPALDO_DATABASE_URL  (obligatoria) Cadena de conexión de la base a respaldar. Es un secreto: el script no la
#                          imprime ni la pasa como argumento a docker (viaja por el entorno del contenedor).
#   RESPALDO_DIR           Carpeta de salida. Por defecto ./respaldos (está en .gitignore).
#   RESPALDO_PREFIJO       Prefijo del nombre del archivo. Por defecto "faro" -> faro-AAAAMMDD-HHMMSS.dump (hora UTC).
#   RESPALDO_IMAGEN        Imagen que trae pg_dump. Por defecto postgres:17-alpine, la misma versión mayor que el
#                          Compose y el CI. pg_dump se niega a respaldar un servidor MÁS NUEVO que él: si el servidor
#                          es PostgreSQL 18, pon aquí postgres:18-alpine.
#
# Termina con código distinto de cero si algo falla, y no deja archivos a medias.

set -euo pipefail

# Git Bash en Windows reescribe argumentos que parecen rutas; aquí estorba y en Linux no hace nada.
export MSYS_NO_PATHCONV=1

IMAGEN="${RESPALDO_IMAGEN:-postgres:17-alpine}"
DIR="${RESPALDO_DIR:-./respaldos}"
PREFIJO="${RESPALDO_PREFIJO:-faro}"

fallar() {
  echo "ERROR: $*" >&2
  exit 1
}

[ -n "${RESPALDO_DATABASE_URL:-}" ] || fallar "falta RESPALDO_DATABASE_URL (la cadena de conexión de la base a respaldar). Ver docs/respaldo.md."
command -v docker >/dev/null 2>&1 || fallar "no se encontró docker. pg_dump se ejecuta con la imagen ${IMAGEN}."
export RESPALDO_DATABASE_URL

# La cadena de conexión y la clave nunca deben salir en un mensaje, ni siquiera dentro de un error de pg_dump.
CLAVE=""
if [[ "$RESPALDO_DATABASE_URL" =~ ^[A-Za-z]+://[^:/@]+:([^@]+)@ ]]; then
  CLAVE="${BASH_REMATCH[1]}"
fi
ocultar() {
  local texto
  texto="$(cat)"
  texto="${texto//"$RESPALDO_DATABASE_URL"/[cadena-de-conexion-oculta]}"
  if [ "${#CLAVE}" -ge 4 ]; then
    texto="${texto//"$CLAVE"/[clave-oculta]}"
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
if ! docker run --rm -i --add-host=host.docker.internal:host-gateway -e RESPALDO_DATABASE_URL "$IMAGEN" \
  sh -c 'exec pg_dump --format=custom --no-password --dbname="$RESPALDO_DATABASE_URL"' \
  >"$parcial" 2>"$errores"; then
  echo "ERROR: pg_dump falló. Mensaje (con la conexión ocultada):" >&2
  ocultar <"$errores" >&2
  if grep -q 'server version mismatch' "$errores"; then
    echo "PISTA: el servidor es más nuevo que pg_dump. Repite con RESPALDO_IMAGEN=postgres:<versión del servidor>-alpine." >&2
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
