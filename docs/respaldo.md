# Copia de seguridad y restauración de la base de datos

- **Fecha:** 22 de noviembre de 2026
- **Issue:** #21 (la copia programada en la nube queda inactiva hasta que el usuario cree lo que se lista en la sección 8)
- **Decisión:** [ADR-0013](adr/0013-copia-de-seguridad-y-restauracion.md)
- **Etiquetas de certeza:** [CONFIRMADO] probado en este repositorio y con la salida a la vista; [PROPUESTA] decidido pero sin medir ni activar; [POR VERIFICAR] escrito con la documentación oficial pero no probado porque requiere la cuenta de Google Cloud o de Neon; [SUPUESTO] razonable pero sin medir; [DESCARTADO] se consideró y no se hizo.

## 1. Qué se respalda y qué no

| Qué | ¿Va en la copia? | Dónde vive y cómo se protege |
|---|---|---|
| **La base de datos completa**: usuarios (con su clave ya en hash argon2), cuadro de clasificación, documentos, versiones (con el texto normalizado de cada PDF), auditoría, sesiones, intentos de ingreso, historial de migraciones, y el disparador que protege la auditoría | **Sí** [CONFIRMADO], con `pg_dump -Fc` | PostgreSQL (Neon en la nube; el Compose en local) |
| **Los PDF** | **No** [CONFIRMADO]. Están en el almacén de archivos (Cloud Storage o RustFS), no en la base: la base solo guarda su clave y su huella SHA-256 | Bucket de documentos (`GCS_BUCKET`). [PROPUESTA] activarle el **versionado de objetos** y una retención corta antes de usar el sistema con documentos que importen; hoy no hay copia de los PDF |
| Los secretos (URL de la base, claves del almacén) | No. Nunca van en una copia ni en el repositorio | Secret Manager y el secreto de GitHub (sección 9) |
| `.env`, claves y tokens | No | Fuera de git (`.gitignore`) |

Consecuencia de que la base y los PDF se respalden por separado: **una copia de la base solo sirve completa si los PDF a los que apunta siguen en el almacén.** [CONFIRMADO leyendo el ADR-004 y el código] Cada PDF es un objeto con clave `documentos/<sha256>.pdf`: depende solo del contenido, así que nunca se sobrescribe con otro contenido, y la API no tiene operación de borrar documentos. Solo se borra un objeto en la compensación de una carga que falló (y únicamente si ninguna versión lo usa) y con el script de huérfanos. Por eso, en la práctica, los PDF a los que apunta una copia vieja siguen en el almacén. Lo que sí pasa al revés (PDF nuevos que la copia vieja no menciona) se explica en la sección 6, punto 5.

## 2. Frecuencia y retención [PROPUESTA]

- **Frecuencia:** una vez al día, a las 02:17 hora de Colombia (07:17 UTC) y a demanda con *Run workflow*. Es un valor inicial para un entorno de pruebas con datos ficticios; con datos que importen se acorta.
- **Retención:** 30 días en el bucket, aplicada por una regla de ciclo de vida del propio bucket (sección 8). La cuenta del flujo no puede borrar nada: así un flujo comprometido no puede destruir los respaldos.
- **Versionado de objetos en el bucket de respaldos:** [PROPUESTA] no activarlo. Cada archivo lleva fecha y hora en el nombre, así que nunca se sobrescribe, y la cuenta del flujo solo puede crear objetos. [SUPUESTO] El borrado temporal que Cloud Storage trae por omisión en los buckets nuevos cubre un borrado accidental por una persona; [POR VERIFICAR] el período vigente en la documentación de Cloud Storage.
- **Tamaño:** con la base de la prueba (10 filas) el respaldo pesa 30 KB. [SUPUESTO] Con documentos reales crece con el texto de los PDF (`versiones`): con el tope de 1 GB del plan gratuito de Neon, 30 copias podrían pasar de la cuota gratuita de Cloud Storage. Con datos ficticios no importa; no está medido.
- **Neon tiene su propia ventana de restauración**, pero corta: [POR VERIFICAR] la documentación pública de Neon (leída el 22 de noviembre de 2026, no desde la cuenta) dice que el plan gratuito conserva hasta 6 horas de historial. Sirve para deshacer un error de hace una hora; **no sustituye** a esta copia para recuperar algo de hace días.

## 3. Qué hay en el repositorio

| Archivo | Para qué |
|---|---|
| `infra/respaldo/respaldar.sh` | `pg_dump -Fc` con la imagen `postgres:17-alpine`; verifica el archivo con `pg_restore --list`; no imprime la conexión ni la clave |
| `infra/respaldo/restaurar.sh` | Restaura **solo en una base nueva** (la crea; se niega si existe) y muestra los conteos por tabla |
| `infra/respaldo/contar.sh` | Filas por tabla de una base, para comparar el original con la copia |
| `.github/workflows/respaldo.yml` | Respaldo programado (cron) y manual hacia un bucket **privado**; inactivo hasta que existan sus variables |
| Trabajo `respaldo` de `.github/workflows/ci.yml` | En cada PR: revisa los scripts con shellcheck, respalda y restaura una base efímera, compara y comprueba las negativas. Si una migración futura rompe la restauración, el CI lo dice antes del desastre |

**Por qué la imagen `postgres:17-alpine` y no un `pg_dump` instalado:** es la misma versión mayor que el Compose y el CI, no hay que instalar nada, y funciona igual en Windows, Linux y el flujo de GitHub. **`pg_dump` se niega a respaldar un servidor más nuevo que él**: si el servidor es PostgreSQL 18, hay que usar `RESPALDO_IMAGEN=postgres:18-alpine` (y `RESTAURAR_IMAGEN` igual al restaurar). El script lo dice cuando pasa.

## 4. Hacer un respaldo a mano

Requisitos: Docker. La cadena de conexión es un secreto: se pasa por una variable de entorno, **no** se escribe en el repositorio ni en un archivo. El script no la imprime ni la entrega como argumento a Docker.

```bash
# Base del Compose local (puerto 5433). Si la clave tiene símbolos como @ o /, escríbelos codificados (%40, %2F).
export RESPALDO_DATABASE_URL='postgresql://faro:CLAVE@host.docker.internal:5433/faro'
infra/respaldo/respaldar.sh                       # deja respaldos/faro-AAAAMMDD-HHMMSS.dump (hora UTC)

# Base de Neon: la cadena DIRECTA (la que no dice -pooler), con ?sslmode=require
export RESPALDO_DATABASE_URL='postgresql://usuario:clave@host/base?sslmode=require'
infra/respaldo/respaldar.sh
```

Variables opcionales: `RESPALDO_DIR` (carpeta de salida, por defecto `./respaldos`, que está en `.gitignore`), `RESPALDO_PREFIJO` y `RESPALDO_IMAGEN`. El archivo se crea con permiso solo para quien lo creó, nunca queda a medias (se escribe aparte y se renombra al verificarlo) y el script termina con código distinto de cero si algo falla. **Un respaldo contiene toda la base: no lo subas a git, a un artefacto de Actions, a un chat ni a un correo.**

## 5. Restaurar

`restaurar.sh` restaura **siempre en una base nueva**; nunca sobre la que está en uso. Se niega (mensaje `ME NIEGO` y código 1) con: `faro`, `postgres`, `template0`, `template1`, cualquier nombre terminado en `_test` (las pruebas automáticas vacían esas bases), la base de la que salió el respaldo (la dice su cabecera), cualquier nombre con mayúsculas o símbolos, y **cualquier base que ya exista**.

```bash
export PGHOST=host.docker.internal PGPORT=5433 PGUSER=faro PGPASSWORD='CLAVE'   # el servidor de destino
infra/respaldo/restaurar.sh respaldos/faro-20261123-040045.dump faro_copia
# Opcional: comparar con la base original si todavía existe
RESTAURAR_COMPARAR_CON=faro infra/respaldo/restaurar.sh respaldos/faro-20261123-040045.dump faro_copia
```

Lo que hace, en orden: valida el nombre, comprueba que el archivo se lee, crea la base, restaura todo en **una sola transacción** (si algo falla, no queda nada a medias; la base vacía se borra a mano con el comando que el script imprime), comprueba que la tabla `auditoria` conserva su disparador y muestra las filas por tabla. Códigos de salida: 0 bien, 1 error o negativa, 2 falta el disparador de auditoría, 3 los conteos difieren de la base de comparación.

La restauración usa `--no-owner --no-privileges`: el respaldo conserva a los dueños, pero al restaurar los objetos quedan a nombre del usuario que restaura (así sirve para pasar de Neon a local o a otro proyecto de Neon, donde ese rol no existe).

### Si hay que recuperar la base de la nube [POR VERIFICAR, no probado contra Neon]

1. Bajar el respaldo elegido: `gcloud storage ls "gs://$BUCKET_RESPALDO/respaldos/"` y `gcloud storage cp "gs://$BUCKET_RESPALDO/respaldos/faro-AAAAMMDD-HHMMSS.dump" .` (lo hace una persona con acceso de lectura al bucket; la cuenta del flujo no puede leer).
2. **Probar primero en local** con el `restaurar.sh` de arriba: así se ve que el archivo está sano antes de tocar la nube.
3. Restaurar en una base nueva del proyecto de Neon (`PGHOST`, `PGUSER`, `PGPASSWORD`, `PGSSLMODE=require` del destino y, si la base de mantenimiento de Neon no se llama `postgres`, `RESTAURAR_BD_MANTENIMIENTO=<su nombre>`). El destino no puede llamarse como la base original: elige otro nombre.
4. Apuntar la aplicación a la base nueva: actualizar el secreto `faro-database-url` en Secret Manager y publicar una revisión nueva de Cloud Run.
5. Hacer las comprobaciones de la sección 6.

## 6. Qué comprobar después de restaurar

1. **Conteos por tabla.** `restaurar.sh` los imprime; con `RESTAURAR_COMPARAR_CON` los compara solo. Una base viva sigue cambiando (sesiones, auditoría), así que la comparación solo es exacta si nadie la usó entre el respaldo y la restauración.
2. **El disparador de auditoría.** `restaurar.sh` comprueba que existe y está activo. Prueba además que funciona: un `UPDATE` o un `DELETE` sobre `public.auditoria` debe fallar con `La tabla auditoria no admite UPDATE (los eventos no se editan ni se borran)`.
3. **Migraciones.** `npm run db:migrate -w apps/api` con `DATABASE_URL` apuntando a la copia no debe aplicar nada: el número de filas de `drizzle.__drizzle_migrations` queda igual.
4. **La aplicación contra la copia.** Con `DATABASE_URL` apuntando a la copia: `/health` con la base en `ok`, ingreso, listado y descarga de un PDF.
5. **Cuidado con los PDF huérfanos** [CONFIRMADO leyendo `apps/api/src/almacen/limpiar-huerfanos.ts`]. Al restaurar un respaldo **anterior** a unas cargas, los PDF subidos después ya no los menciona ninguna fila, y `npm run almacen:huerfanos -w apps/api -- --borrar` **borra los PDF no referenciados de más de una hora**. Tras restaurar, no corras ese comando con `--borrar` hasta revisar la lista (sin `--borrar` solo la muestra).
6. **Sesiones.** La copia trae las sesiones que existían al respaldar. Si se restaura por una intrusión y no por un fallo, [PROPUESTA] vaciar la tabla `sesiones` para que nadie conserve una sesión anterior.

## 7. Prueba de restauración del 22/23 de noviembre de 2026 [CONFIRMADO]

Hecha en local (Windows 11, Git Bash, Docker Desktop) contra el PostgreSQL 17.12 del Compose, con una base de desarrollo aparte (`faro_r`), migrada con `npm run db:migrate -w apps/api` y sembrada con `npm run db:seed -w apps/api` (usuarios `*.demo` y cuadro ficticio). Se agregaron datos con la API compilada: dos PDF ficticios, una versión nueva, un ingreso correcto y uno fallido (eventos de auditoría). La salida de abajo es la real; solo se quitaron la clave y las rutas de este equipo. Las filas de `auditoria` (5) y las demás son pocas a propósito: es una prueba de que el procedimiento funciona, no de volumen.

```text
=== 0. Estado de partida (2026-11-22 23:00) ===
$ psql -d postgres -Atc "select datname from pg_database where datname like 'faro_r%' order by 1"
faro_r

=== 1. Conteos de la base original (faro_r) ===
$ infra/respaldo/contar.sh faro_r
            tabla             | filas
------------------------------+-------
 drizzle.__drizzle_migrations |     8
 public.auditoria             |     5
 public.documentos            |     2
 public.intentos_ingreso      |     0
 public.series_ccd            |     9
 public.sesiones              |     1
 public.usuarios              |     3
 public.versiones             |     3
(8 rows)

=== 2. Respaldo ===
$ RESPALDO_DATABASE_URL=postgresql://<usuario>:<clave>@host.docker.internal:5433/faro_r infra/respaldo/respaldar.sh
Respaldando con pg_dump (imagen postgres:17-alpine)...
Respaldo listo y verificado.
  Archivo:   respaldos/faro-20261123-040045.dump
  Tamaño:    30282 bytes
  SHA-256:   60696d5c3ff23983ab886d735252a73eed5b80bb7612866b91169e471e4a4445
  Contenido: 69 objetos listados, 8 tablas (base de origen: faro_r; servidor PostgreSQL 17.12)

=== 3. Restauración a una base nueva, comparando con la original ===
$ RESTAURAR_COMPARAR_CON=faro_r infra/respaldo/restaurar.sh respaldos/faro-AAAAMMDD-HHMMSS.dump faro_r_restaurada
Creando la base nueva «faro_r_restaurada» en host.docker.internal:5433...
Restaurando respaldos/faro-20261123-040045.dump (todo o nada: una sola transacción)...
Restauración terminada.

Disparador que protege la tabla auditoria:
  auditoria_sin_cambios (activo)

Filas por tabla en «faro_r_restaurada»:
            tabla             | filas
------------------------------+-------
 drizzle.__drizzle_migrations |     8
 public.auditoria             |     5
 public.documentos            |     2
 public.intentos_ingreso      |     0
 public.series_ccd            |     9
 public.sesiones              |     1
 public.usuarios              |     3
 public.versiones             |     3
(8 rows)

Comparación con «faro_r»:
  Los conteos de todas las tablas coinciden.

Listo. Falta comprobar la aplicación contra la copia: ver docs/respaldo.md, sección «Qué comprobar después».
(código de salida: 0)

=== 4. El disparador funciona en la copia (y en la original, para comparar) ===
--- base faro_r_restaurada
$ psql -d faro_r_restaurada -c "UPDATE public.auditoria SET accion = accion WHERE id = (SELECT min(id) FROM public.auditoria)"
ERROR:  La tabla auditoria no admite UPDATE (los eventos no se editan ni se borran)
CONTEXT:  PL/pgSQL function auditoria_inmutable() line 3 at RAISE
$ psql -d faro_r_restaurada -c "DELETE FROM public.auditoria WHERE id = (SELECT min(id) FROM public.auditoria)"
ERROR:  La tabla auditoria no admite DELETE (los eventos no se editan ni se borran)
CONTEXT:  PL/pgSQL function auditoria_inmutable() line 3 at RAISE
--- base faro_r
$ psql -d faro_r -c "UPDATE public.auditoria SET accion = accion WHERE id = (SELECT min(id) FROM public.auditoria)"
ERROR:  La tabla auditoria no admite UPDATE (los eventos no se editan ni se borran)
CONTEXT:  PL/pgSQL function auditoria_inmutable() line 3 at RAISE
$ psql -d faro_r -c "DELETE FROM public.auditoria WHERE id = (SELECT min(id) FROM public.auditoria)"
ERROR:  La tabla auditoria no admite DELETE (los eventos no se editan ni se borran)
CONTEXT:  PL/pgSQL function auditoria_inmutable() line 3 at RAISE
$ filas de auditoría tras los intentos (copia, original)
copia: 5
original: 5

=== 5. npm run db:migrate contra la copia: sin migraciones pendientes ===
base de la migración: faro_r_restaurada
$ migraciones registradas antes:
8
$ npm run db:migrate -w apps/api
[⣷] applying migrations...[✓] migrations applied successfully!
$ migraciones registradas después:
8

=== 6. La API compilada contra la copia: ingreso, listado y descarga de un PDF ===
$ curl /health
{"estado":"ok","api":{"estado":"ok","version":"0.1.0","uptimeSegundos":12},"base":{"estado":"ok","latenciaMs":2},
$ POST /auth/login (admin.demo)
HTTP 200
$ GET /documentos
total: 2 | EXP-R-002 Contrato de obra ficticio | EXP-R-001 Acta de comité ficticia
$ GET /documentos/2/versiones/2/archivo (SHA-256 contra el PDF original)
HTTP 200
5f62ffbf5c3e4b527df6b01f77fe0d182d6fdbb05cd622e9731fcc14e7f1d6a3 *descarga.pdf
5f62ffbf5c3e4b527df6b01f77fe0d182d6fdbb05cd622e9731fcc14e7f1d6a3 *pdfs/contrato-obra-ficticio-v2.pdf
$ GET /auditoria (admin)
eventos: 7 | descarga, ingreso, version, carga, carga, ingreso, ingreso_fallido
líneas ERROR en el registro del servidor: 0

=== 7. El script se niega ===
--- destino: faro
$ infra/respaldo/restaurar.sh respaldos/faro-AAAAMMDD-HHMMSS.dump faro
ME NIEGO: «faro» está protegida: este script solo restaura a una base nueva con otro nombre.
(código de salida: 1)
--- destino: faro_test
ME NIEGO: «faro_test» termina en _test: son las bases de las pruebas automáticas, que vacían sus tablas.
(código de salida: 1)
--- destino: postgres
ME NIEGO: «postgres» está protegida: este script solo restaura a una base nueva con otro nombre.
(código de salida: 1)
--- destino: faro_r
ME NIEGO: «faro_r» es la base de la que salió el respaldo: elija otro nombre para la copia.
(código de salida: 1)
--- destino: faro_r_restaurada
ME NIEGO: la base «faro_r_restaurada» ya existe: este script nunca restaura sobre una base existente.
(código de salida: 1)
--- destino: Faro
ME NIEGO: «Faro» no es un nombre válido: minúscula al inicio y solo minúsculas, números y guion bajo (máx. 63).
(código de salida: 1)
--- destino: faro_r_otra_copia, con RESTAURAR_BASE_ORIGEN=faro_r_otra_copia
ME NIEGO: «faro_r_otra_copia» es la base de origen (RESTAURAR_BASE_ORIGEN): la copia va a otra base nueva.
(código de salida: 1)
--- respaldo que no es un respaldo
pg_restore: error: input file does not appear to be a valid archive (too short?)
ERROR: pg_restore no puede leer falso.dump. ¿Es un respaldo de respaldar.sh? ¿La imagen postgres:17-alpine es lo bastante nueva?
(código de salida: 1)
```

Lo que dice esa salida, y lo que no:

- **El ciclo funciona de punta a punta** [CONFIRMADO]: respaldo verificado, base nueva, las 8 tablas con las mismas filas, el disparador presente y funcionando en la copia, `db:migrate` sin nada pendiente y la API compilada sirviendo la copia con el PDF descargado idéntico byte a byte (misma huella SHA-256).
- **Tras usar la API sobre la copia** la auditoría de la copia pasó de 5 a 7 eventos (el ingreso y la descarga): es de esperar, ya no es idéntica a la original desde que alguien la usa. Los conteos del paso 3 de la salida se tomaron antes de usar la API.
- **Las negativas se probaron en estas formas:** con `faro`, `postgres`, `faro_test` (por el nombre, sin conectarse a nada), con la base de origen, con una base que ya existe, con un nombre inválido, con `RESTAURAR_BASE_ORIGEN` y con un archivo que no es un respaldo. Además, quitando a propósito la regla de `_test` en una copia del script, el script **sí** creó y restauró `faro_r_mut_test` (una base temporal de esta prueba); con la regla puesta se niega. El trabajo `respaldo` del CI repite las negativas en cada PR.
- **Versión del servidor más nueva que `pg_dump`** [CONFIRMADO con una imagen más vieja que el servidor]: con `RESPALDO_IMAGEN=postgres:16-alpine` contra el servidor 17.12 el script falla con código 1, **sin dejar ningún archivo y sin mostrar la conexión**, y dice qué hacer:

  ```text
  ERROR: pg_dump falló. Mensaje (con la conexión ocultada):
  pg_dump: error: aborting because of server version mismatch
  pg_dump: detail: server version: 17.12; pg_dump version: 16.16
  PISTA: el servidor es más nuevo que pg_dump. Repite con RESPALDO_IMAGEN=postgres:<versión del servidor>-alpine.
  ```

  Es el mismo caso que se daría si Neon quedara en PostgreSQL 18 y se usara la imagen 17 (no se probó con una 18 real).
- **Limpieza:** se borraron `faro_r_restaurada` y `faro_r_mut_test` y los archivos de respaldo de la prueba. Quedaron las bases que había antes (`faro`, `faro_test` y las de otros carriles) sin tocar.
- **Lo que NO se probó:** Neon, Cloud Storage, Workload Identity Federation ni la ejecución de `respaldo.yml` (todo [POR VERIFICAR]); un servidor PostgreSQL 18 real; una base con volumen real.
- **Lo que sí repite el CI en cada PR** (trabajo `respaldo`): shellcheck, respaldo y restauración de una base migrada y sembrada, conteos, y las negativas con `faro`, `postgres`, `faro_test` y una base que ya existe.

## 8. Activar el respaldo programado: lo que le toca al usuario

El flujo `.github/workflows/respaldo.yml` **no hace nada** hasta que existan estas cuatro variables del repositorio, y falla con un mensaje claro si falta el secreto. Nadie más puede crearlas: dependen de la cuenta de Google Cloud, de la de Neon y de los ajustes del repositorio. Los comandos son [POR VERIFICAR]: están escritos con la documentación oficial, no se han ejecutado. Reusan las variables de shell de [`docs/despliegue.md`](despliegue.md) (secciones 2 y 7: `PROYECTO`, `REGION`, `REPO_GITHUB`, `NUMERO_PROYECTO`), así que hay que haber hecho antes ese guion (el proveedor de federación `github` ya existe).

```bash
export BUCKET_RESPALDO="${PROYECTO}-respaldos"    # otro bucket, no el de los documentos

# 1. Bucket PRIVADO (sin acceso público posible), con la retención de 30 días [PROPUESTA]
gcloud storage buckets create "gs://$BUCKET_RESPALDO" --location="$REGION" \
  --uniform-bucket-level-access --public-access-prevention
cat > ciclo-de-vida.json <<'EOF'
{ "rule": [ { "action": { "type": "Delete" }, "condition": { "age": 30 } } ] }
EOF
gcloud storage buckets update "gs://$BUCKET_RESPALDO" --lifecycle-file=ciclo-de-vida.json

# 2. Cuenta de servicio que SOLO puede crear objetos en ese bucket (no leer, listar, sobrescribir ni borrar)
gcloud iam service-accounts create faro-respaldo --display-name="Faro (respaldo desde GitHub)"
export SA_RESPALDO="faro-respaldo@${PROYECTO}.iam.gserviceaccount.com"
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET_RESPALDO" \
  --member="serviceAccount:$SA_RESPALDO" --role="roles/storage.objectCreator"

# 3. Que el repositorio (solo desde main) pueda actuar como esa cuenta, con el MISMO proveedor de federación
gcloud iam service-accounts add-iam-policy-binding "$SA_RESPALDO" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${NUMERO_PROYECTO}/locations/global/workloadIdentityPools/github/attribute.repository/${REPO_GITHUB}"
```

Si la primera subida falla con un error 403 que menciona `storage.objects.get` o `storage.objects.list`, el rol `objectCreator` no basta para la forma en que `gcloud storage cp` sube [POR VERIFICAR]; la alternativa es `roles/storage.objectUser` sobre **ese bucket** (puede leer y sobrescribir, pero sigue sin poder tocar nada fuera de él).

En GitHub, **Settings → Secrets and variables → Actions**:

| Dónde | Nombre | Valor |
|---|---|---|
| Variables | `GCP_PROJECT_ID`, `GCP_WIF_PROVIDER` | Las mismas que ya crea el guion de despliegue |
| Variables | `GCP_RESPALDO_SA` | El valor de `$SA_RESPALDO` |
| Variables | `GCS_RESPALDO_BUCKET` | El valor de `$BUCKET_RESPALDO` |
| Variables (opcional) | `RESPALDO_IMAGEN` | Solo si la base de Neon no es PostgreSQL 17, p. ej. `postgres:18-alpine` |
| **Secretos** | `RESPALDO_DATABASE_URL` | La cadena de conexión **directa** de Neon (sin `-pooler`) con `?sslmode=require` |

El secreto lo crea el usuario con su propia mano; nadie más lo ve ni lo escribe. [PROPUESTA] Que sea un rol de Neon **solo de lectura** creado para el respaldo (`pg_dump` solo necesita leer), no el dueño de la base que usa la aplicación: así una filtración de ese secreto no permite modificar los datos. [POR VERIFICAR] Cómo se crea ese rol en Neon y que `pg_dump` funcione con él; si no se logra, se usa la cadena de siempre y se anota.

Después de crearlo todo: **Actions → Respaldo → Run workflow** (desde `main`), y comprobar que el archivo aparece en `gs://$BUCKET_RESPALDO/respaldos/` (`gcloud storage ls`). La autenticación sin llaves exige lanzarlo desde `main`, igual que el despliegue.

**Lo que conviene saber:**

- Mientras no existan las variables, el calendario sigue despertando al flujo cada día y el trabajo se omite sin hacer nada [SUPUESTO: aparecerá como una ejecución omitida en la pestaña Actions].
- GitHub desactiva los flujos programados de un repositorio público tras 60 días sin actividad. Si pasa, se reactiva a mano. [POR VERIFICAR] el plazo vigente.
- El respaldo **no se sube como artefacto de GitHub Actions ni se imprime en el registro**: el repositorio es público y cualquiera puede descargar los artefactos y leer los registros.

## 9. Quién custodia qué

| Qué | Quién | Nota |
|---|---|---|
| El secreto `RESPALDO_DATABASE_URL` y las variables | El dueño del repositorio (hoy Juan) | Solo él puede crearlos y cambiarlos |
| El acceso de lectura al bucket de respaldos | El dueño del proyecto de Google Cloud (hoy Juan) | La cuenta del flujo no lee; para restaurar hace falta una persona con acceso |
| La clave de la base de Neon | El dueño de la cuenta de Neon (hoy Juan) | La misma que va en Secret Manager (`faro-database-url`) |

[SUPUESTO] Hoy todo depende de una sola persona, que es el riesgo que el plan ya anota. [PROPUESTA] Que una segunda persona del equipo tenga acceso de lectura al bucket y sepa restaurar; [POR VERIFICAR] a quién y cómo. Si se pierde el acceso a la cuenta de Google Cloud, se pierden también las copias.

## 10. Límites y riesgos conocidos

- **Los datos son ficticios.** Si algún día hubiera datos reales, la copia en el bucket está cifrada en reposo por Google pero no con una clave propia; [PROPUESTA] estudiar una clave propia y la autorización de la entidad antes de guardar datos reales (queda fuera de este issue).
- **Una copia que nunca se restaura es una esperanza, no un respaldo.** Por eso la restauración se prueba en cada PR (trabajo `respaldo` del CI). [PROPUESTA] Repetir la prueba contra el bucket real tras la primera ejecución programada: bajar el archivo y pasarlo por `restaurar.sh`.
- **Neon suspende el cómputo sin uso** y el primer acceso tarda. [POR VERIFICAR] si el respaldo programado lo despierta cada día y cuánto del cupo de horas de cómputo del plan gratuito gasta (la documentación pública habla de 100 horas por proyecto al mes; no se midió).
- **Los límites de Neon** (almacenamiento del plan gratuito, ventana de restauración, versiones de PostgreSQL) cambian: [POR VERIFICAR] en la página de precios el día de activar el respaldo. Lo leído el 22 de noviembre de 2026 en la documentación pública, sin cuenta: Neon admite PostgreSQL 14 a 19, **los proyectos nuevos usan la 18 por omisión** y la versión mayor de un proyecto no se cambia en el sitio. Como el Compose, el CI y esta guía usan 17, **al crear el proyecto de Neon conviene elegir PostgreSQL 17** (`docs/despliegue.md`, sección 4); si queda en 18, se pone `RESPALDO_IMAGEN=postgres:18-alpine` y `RESTAURAR_IMAGEN` igual. [POR VERIFICAR] que la API y las migraciones funcionan en 18 (el CI solo prueba 17).
- **Restaurar un respaldo de PostgreSQL 18 en un servidor 17 no está garantizado**: lo que documenta PostgreSQL es restaurar en la misma versión mayor o en una más nueva. [SUPUESTO] No se probó el caso contrario; por eso el destino debe ser de la misma versión mayor que el origen o más nuevo.
- **El flujo programado no se ha ejecutado nunca** (requiere la cuenta). Se revisó con actionlint y shellcheck, y sus scripts se prueban a diario en el CI, pero la parte de Google Cloud es [POR VERIFICAR].
