#!/usr/bin/env bash
# Pruebas de comun.sh: el analizador de la cadena de conexión (clave con codificación porcentual, parámetros, rechazos) y
# la imagen fijada por huella. Solo usa bash: no necesita Docker ni base de datos. Se corre a mano y en el CI.
#
# Uso: infra/respaldo/probar-conexion.sh
# Termina con código 0 si todo pasa y 1 si algo falla. Los secretos de estas pruebas son ficticios.

set -uo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=comun.sh
source "$AQUI/comun.sh"

fallos=0
pruebas=0

ok() {
  pruebas=$((pruebas + 1))
  echo "  ok: $1"
}
mal() {
  pruebas=$((pruebas + 1))
  fallos=$((fallos + 1))
  echo "  FALLA: $1" >&2
}
igual() { # igual <descripción> <esperado> <obtenido>
  if [ "$2" = "$3" ]; then ok "$1"; else mal "$1 (esperado y obtenido difieren)"; fi
}

# analizar <url>: corre el analizador en un subproceso y vuelca las variables resultantes, una por línea, sin
# mostrar nada más. Devuelve el código del analizador.
analizar() {
  (
    analizar_url_postgres "$1" || exit 3
    for v in PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSSLMODE PGCHANNELBINDING PGCONNECT_TIMEOUT PGAPPNAME PGOPTIONS; do
      if [ -n "${!v+x}" ]; then printf '%s=%s\n' "$v" "${!v}"; fi
    done
  )
}
valor() { # valor <salida de analizar> <variable> -> el valor, o vacío
  printf '%s\n' "$1" | sed -n "s/^$2=//p"
}

echo "Analizador de la cadena de conexión"

# 1. Caso simple
salida="$(analizar 'postgresql://faro:cambia@localhost:5433/faro')"
igual "usuario" "faro" "$(valor "$salida" PGUSER)"
igual "clave" "cambia" "$(valor "$salida" PGPASSWORD)"
igual "host" "localhost" "$(valor "$salida" PGHOST)"
igual "puerto" "5433" "$(valor "$salida" PGPORT)"
igual "base" "faro" "$(valor "$salida" PGDATABASE)"
igual "sin parámetros no hay PGSSLMODE" "" "$(valor "$salida" PGSSLMODE)"

# 2. Clave con TODOS los caracteres especiales, codificados; debe quedar decodificada
original='Pw@Ab:c/d#e%f?g&h=i+j k'
codificada='Pw%40Ab%3Ac%2Fd%23e%25f%3Fg%26h%3Di%2Bj%20k'
salida="$(analizar "postgres://usuario:${codificada}@host.ejemplo.com/base")"
igual "clave con @ : / # % ? & = + y espacio (esquema postgres://)" "$original" "$(valor "$salida" PGPASSWORD)"
igual "puerto por omisión: no se fija" "" "$(valor "$salida" PGPORT)"

# 3. Un % codificado primero no se decodifica dos veces (%2540 es el texto %40, no @)
salida="$(analizar 'postgresql://u:a%2540b@h/db')"
igual "no decodifica dos veces" 'a%40b' "$(valor "$salida" PGPASSWORD)"

# 4. UTF-8 (ñ = %C3%B1) y usuario con @ codificado
salida="$(analizar 'postgresql://a%40b:contrase%C3%B1a@h/db')"
igual "usuario con @ codificado" "a@b" "$(valor "$salida" PGUSER)"
igual "clave con UTF-8" "contraseña" "$(valor "$salida" PGPASSWORD)"

# 5. Clave con : sin codificar (libpq la lee hasta la @)
salida="$(analizar 'postgresql://u:a:b@h/db')"
igual "clave con : sin codificar" "a:b" "$(valor "$salida" PGPASSWORD)"

# 6. Forma de Neon, con parámetros
salida="$(analizar 'postgresql://neondb_owner:npg_AbC123@ep-cool-123.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require')"
igual "Neon: host" "ep-cool-123.us-east-2.aws.neon.tech" "$(valor "$salida" PGHOST)"
igual "Neon: sslmode" "require" "$(valor "$salida" PGSSLMODE)"
igual "Neon: channel_binding" "require" "$(valor "$salida" PGCHANNELBINDING)"
igual "Neon: base" "neondb" "$(valor "$salida" PGDATABASE)"

# 7. Otros parámetros admitidos, IPv6 y puerto con ceros a la izquierda
salida="$(analizar 'postgresql://u:p@[::1]:05432/db?connect_timeout=7&application_name=faro%20respaldo&options=-c%20statement_timeout%3D0')"
igual "IPv6: host" "::1" "$(valor "$salida" PGHOST)"
igual "puerto con ceros" "5432" "$(valor "$salida" PGPORT)"
igual "connect_timeout" "7" "$(valor "$salida" PGCONNECT_TIMEOUT)"
igual "application_name decodificado" "faro respaldo" "$(valor "$salida" PGAPPNAME)"
igual "options decodificado" "-c statement_timeout=0" "$(valor "$salida" PGOPTIONS)"

# 8. Sin clave en la cadena: PGPASSWORD no se fija (y la de quien llama no se cuela)
salida="$(PGPASSWORD=ajena PGSSLMODE=disable PGHOST=otro PGOPTIONS=x analizar 'postgresql://u@h/db')"
igual "sin clave: PGPASSWORD vacío" "" "$(valor "$salida" PGPASSWORD)"
igual "no se cuela PGSSLMODE de afuera" "" "$(valor "$salida" PGSSLMODE)"
igual "no se cuela PGOPTIONS de afuera" "" "$(valor "$salida" PGOPTIONS)"
igual "PGHOST sale de la cadena y no de afuera" "h" "$(valor "$salida" PGHOST)"

# 9. Rechazos (fallan cerrado): código 3 y NADA de la cadena en la salida ni en el motivo
secreto='SECRETO-9x7'
rechazar() { # rechazar <descripción> <url>
  local salida_r motivo codigo
  salida_r="$(analizar "$2" 2>&1)"
  codigo=$?
  motivo="$(
    analizar_url_postgres "$2" 2>&1 >/dev/null
    printf '%s' "${MOTIVO_URL-}"
  )"
  if [ "$codigo" -ne 3 ]; then
    mal "$1: debía rechazarse"
  elif [[ "$salida_r$motivo" == *"$secreto"* ]]; then
    mal "$1: la salida repite la clave"
  else
    ok "$1"
  fi
}
rechazar "esquema que no es postgres" "mysql://u:${secreto}@h/db"
rechazar "sin esquema" "u:${secreto}@h/db"
rechazar "sin host" "postgresql://u:${secreto}@/db"
rechazar "sin usuario" "postgresql://:${secreto}@h/db"
rechazar "sin base" "postgresql://u:${secreto}@h"
rechazar "base vacía" "postgresql://u:${secreto}@h/"
rechazar "%00 en la clave" "postgresql://u:${secreto}%00x@h/db"
rechazar "% mal formado en la clave (%zz)" "postgresql://u:${secreto}%zz@h/db"
rechazar "% suelto al final" "postgresql://u:${secreto}%@h/db"
rechazar "puerto no numérico" "postgresql://u:${secreto}@h:abc/db"
rechazar "puerto fuera de rango" "postgresql://u:${secreto}@h:70000/db"
rechazar "puerto cero" "postgresql://u:${secreto}@h:0/db"
rechazar "varios hosts" "postgresql://u:${secreto}@h1,h2/db"
rechazar "varios hosts con puerto" "postgresql://u:${secreto}@h1:5432,h2:5432/db"
rechazar "@ sin codificar en la clave (el host quedaría mal)" "postgresql://u:${secreto}@x@h/db"
rechazar "parámetro desconocido" "postgresql://u:${secreto}@h/db?foo=bar"
rechazar "clave dada como parámetro" "postgresql://u@h/db?password=${secreto}"
rechazar "parámetro sin valor" "postgresql://u:${secreto}@h/db?sslmode"
rechazar "sslmode inválido" "postgresql://u:${secreto}@h/db?sslmode=${secreto}"
rechazar "channel_binding inválido" "postgresql://u:${secreto}@h/db?channel_binding=x"
rechazar "connect_timeout inválido" "postgresql://u:${secreto}@h/db?connect_timeout=abc"
rechazar "socket de Unix como host" "postgresql://u:${secreto}@%2Fvar%2Frun%2Fpostgresql/db"
rechazar "host con espacios" "postgresql://u:${secreto}@ho%20st/db"
rechazar "ruta con barras en la base" "postgresql://u:${secreto}@h/a/b"
rechazar "IPv6 sin cerrar" "postgresql://u:${secreto}@[::1/db"

echo
echo "Imagen por defecto"
if [[ "$IMAGEN_POR_DEFECTO" =~ ^postgres:17-alpine@sha256:[0-9a-f]{64}$ ]]; then
  ok "postgres:17-alpine fijada por huella (digest)"
else
  mal "IMAGEN_POR_DEFECTO no es postgres:17-alpine@sha256:<64 hex>"
fi
# La huella no se repite (a mano) en otros scripts: solo vive en comun.sh.
otros="$(grep -l 'sha256:[0-9a-f]\{64\}' "$AQUI"/respaldar.sh "$AQUI"/restaurar.sh "$AQUI"/contar.sh 2>/dev/null || true)"
igual "la huella solo está en comun.sh (un solo lugar que actualizar)" "" "$otros"

echo
if [ "$fallos" -eq 0 ]; then
  echo "Todo bien: ${pruebas} comprobaciones."
else
  echo "FALLARON ${fallos} de ${pruebas} comprobaciones." >&2
  exit 1
fi
