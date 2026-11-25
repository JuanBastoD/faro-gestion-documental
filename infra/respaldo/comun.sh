#!/usr/bin/env bash
# Piezas comunes de los scripts de respaldo (respaldar.sh, restaurar.sh, contar.sh). Se carga con `source`; no se ejecuta.
# Guía: docs/respaldo.md.

# Imagen que trae pg_dump, pg_restore y psql, FIJADA POR HUELLA (digest) y no por etiqueta: recibe la clave de la base,
# y una etiqueta (postgres:17-alpine) la puede mover quien controle la imagen. Es el índice multiarquitectura de la
# etiqueta postgres:17-alpine tal como estaba el 23 de noviembre de 2026 (linux/amd64 construida el 18 de noviembre de
# 2026; PostgreSQL 17.12). Es la misma versión mayor que el Compose y el CI.
# Para actualizarla: docs/respaldo.md, sección «Actualizar la imagen fijada» (se revisa con un PR).
# Cada script permite reemplazarla con su variable de entorno (RESPALDO_IMAGEN o RESTAURAR_IMAGEN).
# shellcheck disable=SC2034 # la usan los scripts que cargan este archivo
IMAGEN_POR_DEFECTO='postgres:17-alpine@sha256:f9cf3e1f0066f0eb0c48707d864f0ac5941e9ff454a072077d97a4d278d07d73'

# Variables de libpq que pueden venir del entorno de quien llama y que NO deben influir en la conexión del respaldo.
VARIABLES_PG='PGHOST PGHOSTADDR PGPORT PGUSER PGPASSWORD PGPASSFILE PGDATABASE PGSSLMODE PGCHANNELBINDING PGCONNECT_TIMEOUT PGAPPNAME PGOPTIONS PGSERVICE PGSERVICEFILE PGSSLROOTCERT PGSSLCERT PGSSLKEY PGTARGETSESSIONATTRS'

# decodificar_porcentaje <texto>
# Deshace la codificación porcentual de una URL (%40 -> @) y deja el resultado en DECODIFICADO.
# Devuelve 1, sin imprimir nada, si hay un % mal formado o un %00 (libpq también los rechaza).
decodificar_porcentaje() {
  local resto="$1" salida="" hex caracter
  while [ -n "$resto" ]; do
    if [ "${resto:0:1}" = "%" ]; then
      hex="${resto:1:2}"
      [[ "$hex" =~ ^[0-9A-Fa-f]{2}$ ]] || return 1
      [ "$hex" != "00" ] || return 1
      printf -v caracter '%b' "\\x${hex}"
      salida+="$caracter"
      resto="${resto:3}"
    else
      salida+="${resto:0:1}"
      resto="${resto:1}"
    fi
  done
  DECODIFICADO="$salida"
}

# analizar_url_postgres <url>
# Descompone postgresql://usuario:clave@host:puerto/base?sslmode=require en las variables de entorno de libpq
# (PGUSER, PGPASSWORD, PGHOST, PGPORT, PGDATABASE, PGSSLMODE...), exportadas, de modo que la clave viaje por el
# ENTORNO del contenedor y no como argumento de ningún proceso (el entorno de un proceso solo lo lee su dueño; sus
# argumentos, cualquier usuario del equipo).
#   - Usa solo bash. La clave se decodifica (%40 -> @, %3A -> :, %2F -> /, %23 -> #, %25 -> %, %3F -> ?).
#   - Falla CERRADO: ante cualquier cosa rara devuelve 1 y deja en MOTIVO_URL un mensaje FIJO. Nunca imprime ni
#     devuelve un trozo de la URL, ni siquiera el nombre de un parámetro desconocido.
#   - Antes de asignar, borra del entorno toda variable PG* que traiga quien llama, para que ninguna se cuele.
#   - Solo admite un host (sin listas), sin socket de Unix y los parámetros sslmode, channel_binding,
#     connect_timeout, application_name y options.
# Deja además CLAVE_CODIFICADA (la clave tal como venía en la URL), para que el script pueda tapar ambas formas.
analizar_url_postgres() {
  local url="$1" resto usuario="" clave="" tiene_clave=0 autoridad host="" puerto="" base="" consulta="" tras
  local -a pares
  local par nombre valor
  MOTIVO_URL=""
  CLAVE_CODIFICADA=""
  # shellcheck disable=SC2086 # la lista se separa a propósito
  unset $VARIABLES_PG

  case "$url" in
    postgresql://*) resto="${url#postgresql://}" ;;
    postgres://*) resto="${url#postgres://}" ;;
    *)
      MOTIVO_URL="la cadena de conexión no empieza por postgresql:// ni postgres://"
      return 1
      ;;
  esac

  # Usuario y clave: hasta la primera @ siempre que antes no haya una / (así lo hace libpq). La clave puede
  # llevar : sin codificar; todo lo demás raro debe ir codificado.
  autoridad="${resto%%/*}"
  if [[ "$autoridad" == *@* ]]; then
    usuario="${resto%%@*}"
    resto="${resto#*@}"
    if [[ "$usuario" == *:* ]]; then
      clave="${usuario#*:}"
      usuario="${usuario%%:*}"
      tiene_clave=1
    fi
  fi
  CLAVE_CODIFICADA="$clave"

  # Parámetros (?a=b&c=d)
  if [[ "$resto" == *\?* ]]; then
    consulta="${resto#*\?}"
    resto="${resto%%\?*}"
  fi

  # Host, puerto y base
  autoridad="${resto%%/*}"
  if [[ "$resto" == */* ]]; then
    base="${resto#*/}"
  fi
  if [[ "$autoridad" == \[* ]]; then
    if [[ "$autoridad" != *\]* ]]; then
      MOTIVO_URL="el host de la cadena de conexión no es válido"
      return 1
    fi
    host="${autoridad%%\]*}"
    host="${host#\[}"
    tras="${autoridad#*\]}"
    if [ -n "$tras" ]; then
      [ "${tras:0:1}" = ":" ] || { MOTIVO_URL="el host de la cadena de conexión no es válido"; return 1; }
      puerto="${tras:1}"
    fi
  elif [[ "$autoridad" == *:* ]]; then
    host="${autoridad%%:*}"
    puerto="${autoridad#*:}"
  else
    host="$autoridad"
  fi

  decodificar_porcentaje "$host" || { MOTIVO_URL="la cadena de conexión tiene una codificación porcentual no válida"; return 1; }
  host="$DECODIFICADO"
  if [[ ! "$host" =~ ^[A-Za-z0-9._-]+$ && ! "$host" =~ ^[0-9A-Fa-f:.]+$ ]]; then
    MOTIVO_URL="el host de la cadena de conexión falta o no es válido (se admite un solo host, sin socket de Unix)"
    return 1
  fi
  if [ -n "$puerto" ]; then
    if [[ ! "$puerto" =~ ^[0-9]{1,5}$ ]] || [ "$((10#$puerto))" -lt 1 ] || [ "$((10#$puerto))" -gt 65535 ]; then
      MOTIVO_URL="el puerto de la cadena de conexión no es válido"
      return 1
    fi
  fi

  decodificar_porcentaje "$usuario" || { MOTIVO_URL="la cadena de conexión tiene una codificación porcentual no válida"; return 1; }
  usuario="$DECODIFICADO"
  if [ -z "$usuario" ]; then
    MOTIVO_URL="la cadena de conexión no trae usuario"
    return 1
  fi
  if [ "$tiene_clave" -eq 1 ]; then
    decodificar_porcentaje "$clave" || { MOTIVO_URL="la cadena de conexión tiene una codificación porcentual no válida"; return 1; }
    clave="$DECODIFICADO"
  fi
  decodificar_porcentaje "$base" || { MOTIVO_URL="la cadena de conexión tiene una codificación porcentual no válida"; return 1; }
  base="$DECODIFICADO"
  if [ -z "$base" ] || [[ "$base" == */* ]]; then
    MOTIVO_URL="la cadena de conexión no trae el nombre de la base (o trae una ruta con barras)"
    return 1
  fi

  # Parámetros admitidos, con su valor validado; cualquier otro hace fallar la lectura sin nombrarlo.
  local sslmode="" canal="" espera="" aplicacion="" opciones=""
  if [ -n "$consulta" ]; then
    IFS='&' read -r -a pares <<<"$consulta"
    for par in "${pares[@]}"; do
      [[ "$par" == *=* ]] || { MOTIVO_URL="un parámetro de la cadena de conexión no es válido"; return 1; }
      decodificar_porcentaje "${par%%=*}" || { MOTIVO_URL="la cadena de conexión tiene una codificación porcentual no válida"; return 1; }
      nombre="$DECODIFICADO"
      decodificar_porcentaje "${par#*=}" || { MOTIVO_URL="la cadena de conexión tiene una codificación porcentual no válida"; return 1; }
      valor="$DECODIFICADO"
      case "$nombre" in
        sslmode)
          case "$valor" in
            disable | allow | prefer | require | verify-ca | verify-full) sslmode="$valor" ;;
            *) MOTIVO_URL="el valor de sslmode no es válido"; return 1 ;;
          esac
          ;;
        channel_binding)
          case "$valor" in
            disable | prefer | require) canal="$valor" ;;
            *) MOTIVO_URL="el valor de channel_binding no es válido"; return 1 ;;
          esac
          ;;
        connect_timeout)
          [[ "$valor" =~ ^[0-9]{1,4}$ ]] || { MOTIVO_URL="el valor de connect_timeout no es válido"; return 1; }
          espera="$valor"
          ;;
        application_name) aplicacion="$valor" ;;
        options) opciones="$valor" ;;
        *)
          MOTIVO_URL="la cadena de conexión trae un parámetro no admitido (admitidos: sslmode, channel_binding, connect_timeout, application_name, options)"
          return 1
          ;;
      esac
    done
  fi

  export PGHOST="$host" PGUSER="$usuario" PGDATABASE="$base"
  [ -z "$puerto" ] || export PGPORT="$((10#$puerto))"
  [ "$tiene_clave" -eq 0 ] || export PGPASSWORD="$clave"
  [ -z "$sslmode" ] || export PGSSLMODE="$sslmode"
  [ -z "$canal" ] || export PGCHANNELBINDING="$canal"
  [ -z "$espera" ] || export PGCONNECT_TIMEOUT="$espera"
  [ -z "$aplicacion" ] || export PGAPPNAME="$aplicacion"
  [ -z "$opciones" ] || export PGOPTIONS="$opciones"
  return 0
}
