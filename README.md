# Faro · Gestión documental

Sistema de gestión documental para la E.I.C.E. Faro del Catatumbo S.A.S. Proyecto de clase (Proyecto Integrador AR, Universidad de Pamplona, 2026-2P). Usa únicamente **datos ficticios**. No es un SGDEA en producción.

## Estructura del monorepo

| Carpeta | Contenido | Estado |
|---|---|---|
| `apps/api` | API REST (NestJS, PostgreSQL) | En construcción (hito V2-M1) |
| `apps/web` | Interfaz web (React + Vite) | Pendiente (hito V2-M4) |
| `infra/` | Docker, CI y despliegue | En construcción |
| `docs/` | Plan, decisiones de arquitectura (`docs/adr/`), diagramas y manual | Activo |
| `legacy/prototipo-v1/` | Primer incremento (Express + SQLite), etiquetado `v0.1.0` | Congelado |

## Dónde está el trabajo

- Plan de mejora y arquitectura: [`docs/PLAN_MEJORA.md`](docs/PLAN_MEJORA.md)
- Modelo de datos (diagrama entidad-relación y diccionario por tabla y campo): [`docs/modelo-de-datos.md`](docs/modelo-de-datos.md). Una prueba lo compara con la base migrada, así que el CI falla si queda desactualizado
- Quién puede hacer qué, endpoint por endpoint: [`docs/matriz-de-roles.md`](docs/matriz-de-roles.md). Una prueba la lee y la comprueba contra la API real con un usuario de cada rol; si se agrega un endpoint sin decidir sus permisos, el CI falla.
- Diagrama de componentes y diferencias con el ADR-002: [`docs/arquitectura.md`](docs/arquitectura.md).
- Issues e hitos `V2-M1` a `V2-M4`: pestaña Issues del repositorio
- Tablero: <https://github.com/users/JuanBastoD/projects/2>

## Entorno local (PostgreSQL y almacén S3)

Requisitos: Node.js 22.13 o superior y Docker con Compose.

```
cp .env.example .env     # en Windows: copy .env.example .env
npm run infra:up         # levanta PostgreSQL y el almacén de archivos, y crea el bucket
```

`.env` no se sube a git. Cambia las claves de ejemplo antes de usarlo y no las reutilices en la nube ni con datos reales.

| Servicio | Dirección en este equipo | Notas |
|---|---|---|
| PostgreSQL 17 | `localhost:5433` | Usuario, clave y base en `.env`. Usa 5433 para no chocar con un PostgreSQL local en el 5432. |
| Almacén S3 (RustFS) | `localhost:9000` (API) y `localhost:9001` (consola) | Bucket `faro-documentos` creado al arrancar. |

Comandos: `npm run infra:down` detiene los servicios y conserva los datos; `npm run infra:reset` los borra; `npm run infra:logs` muestra los registros.

Los puertos solo escuchan en `127.0.0.1`. Si cambias un puerto en `.env`, actualiza también `DATABASE_URL` y `S3_ENDPOINT`.

**Por qué RustFS y no MinIO:** las imágenes oficiales de MinIO ya no se publican (Docker Hub devuelve `object not found` y Quay no tiene manifiestos públicos; verificado el 22 de noviembre de 2026). RustFS expone la misma API S3, así que el código de la API no cambia.

## API (`apps/api`)

NestJS 12 con PostgreSQL (Drizzle ORM). Con la infraestructura arriba (`npm run infra:up`) y el `.env` copiado:

```
npm install
npm run db:migrate -w apps/api     # aplica las migraciones
npm run start:dev -w apps/api      # API en http://127.0.0.1:3000
```

`GET /health` devuelve el estado de la API y de la base. Responde 200 si todo está bien y 503 si la base no contesta.

**Ingreso y roles** ([ADR-003](docs/adr/0003-autenticacion-y-sesiones.md)): todo exige sesión salvo `/health` y `POST /auth/login`. Las sesiones viven en PostgreSQL y las claves usan argon2id.

**Seguridad mínima** ([ADR-009](docs/adr/0009-seguridad-minima-para-exponer-la-api.md)): tras **5 intentos de ingreso** por usuario (existiera o no) o **30 por IP** en 15 minutos, la API responde **429** con `Retry-After`; las peticiones que modifican datos desde otro sitio (según `Origin` y `Sec-Fetch-Site`) reciben **403** `origen_no_permitido`; las cabeceras son las de `helmet`. Configuración: `CONFIAR_EN_PROXY` (cuántos proxies hay delante; Cloud Run: 1) y `ORIGENES_PERMITIDOS`, ver `.env.example`.

```
npm run db:seed -w apps/api      # migra y crea admin.demo, editor.demo, consulta.demo y el cuadro de clasificación (ficticios)
```

La clave de esos usuarios es `SEMILLA_CLAVE` de tu `.env`. La siembra se niega a correr con `NODE_ENV=production`.

| Ruta | Quién | Qué hace |
|---|---|---|
| `POST /auth/login` | Cualquiera | Recibe `{ usuario, clave }` y pone la cookie `faro_sesion`. Con demasiados intentos responde 429 y `Retry-After` |
| `GET /auth/yo` | Con sesión | Devuelve quién tiene la sesión: `{ usuario: { id, usuario, nombre, rol, debeCambiarClave } }` |
| `POST /auth/logout` | Con sesión | Cierra la sesión |
| `POST /auth/clave` | Con sesión | Cambia la clave propia: `{ claveActual, claveNueva }` (la nueva, de 12 a 256 caracteres y distinta de la actual). Responde 204; cierra las demás sesiones de la persona y deja la actual. **400 `clave_actual_incorrecta`** (nunca 401) si la actual no es correcta, y esos fallos cuentan en el límite de ingreso (429 con `Retry-After`) |
| `GET /series` | Con sesión | Cuadro de clasificación como árbol de dos niveles (series y subseries). Solo las subseries admiten documentos; lo impone el servicio y la base de datos |
| `POST /documentos` | Administrador y editor | Carga un PDF (formulario multipart: archivo en `archivo`, más `titulo`, `expediente`, `serieId` de una subserie, `fechaDocumento` AAAA-MM-DD y `motivo` opcional; con un aviso de duplicado, también `decision`, `documentoId` y `justificacion`). Solo PDF por su contenido, máx. 20 MB. 415 si no es PDF, 413 si pasa de 20 MB, 400 si faltan datos, 422 si la serie no es una subserie, **409 si ya existe un archivo idéntico (`duplicado_exacto`) o uno muy parecido (`duplicado_probable`)** |
| `GET /documentos` | Con sesión | Listado y búsqueda. Sin parámetros, el más reciente primero. `q` busca en título, expediente y texto del PDF (todas las palabras, sin tildes ni mayúsculas, por relevancia); `serieId` filtra por serie o subserie (con sus subseries); `pagina` y `tamano` (máx. 50). Responde `{ items, total, pagina, tamano }` |
| `GET /documentos/:id` | Con sesión | Documento con el historial de versiones |
| `GET /documentos/:id/versiones/:n/archivo` | Con sesión | Descarga el PDF de una versión (queda en la auditoría) |
| `GET /documentos/:id/versiones` | Con sesión | Historial de versiones, la más reciente primero (número, autor, fecha, motivo, de cuál se restauró) |
| `POST /documentos/:id/versiones` | Administrador y editor | Sube una versión nueva (multipart: `archivo` PDF y `motivo` obligatorio, hasta 300 caracteres). 409 si el contenido ya está en una versión de ese documento |
| `POST /documentos/:id/versiones/:n/restaurar` | Administrador y editor | Crea una versión nueva con el contenido de la `n`; no edita ni borra nada (`motivo` opcional). 409 si la vigente ya tiene ese contenido |
| `GET /usuarios` | Administrador | Todos los usuarios, activos e inactivos, por orden de creación (sin la clave) |
| `POST /usuarios` | Administrador | Crea un usuario: `{ usuario, nombre, rol, clave }`. `usuario` en minúsculas (3 a 64: letras, números, `.`, `-`, `_`), `clave` de 12 a 256 caracteres. 409 si el nombre ya existe |
| `PATCH /usuarios/:id` | Administrador | Cambia `rol` y/o `activo`. Nunca se borra a nadie; desactivar cierra sus sesiones. 409 `ultimo_administrador` si dejaría al sistema sin administradores activos |
| `POST /usuarios/:id/clave` | Administrador | Fija una **clave temporal** a otro usuario: `{ clave }` (12 a 256 caracteres). Responde 204 sin cuerpo; cierra todas sus sesiones y le exige cambiarla al ingresar. 409 `restablecer_clave_propia` si es la cuenta del propio administrador (para eso está `POST /auth/clave`); 404 si no existe |
| `GET /auditoria` | Administrador | Eventos de auditoría, los más recientes primero. Filtros: `usuarioId`, `accion`, `documentoId`, `desde`, `hasta`; paginación: `pagina` y `tamano` (máx. 100). Solo lectura: los eventos no se editan ni se borran, ni por la API ni por SQL |

**Claves** ([ADR-011](docs/adr/0011-cambio-y-restablecimiento-de-clave.md)): cada persona cambia la suya con `POST /auth/clave`, dando la actual aunque tenga sesión. Quien la olvida no la recupera solo (no hay correo): un administrador le fija una **clave temporal** con `POST /usuarios/:id/clave` y se la entrega por otro medio. Con una clave temporal, la persona puede ingresar, pero hasta que la cambie la API solo le responde `GET /auth/yo`, `POST /auth/logout` y `POST /auth/clave`; todo lo demás es **403 `cambio_de_clave_requerido`**, y `usuario.debeCambiarClave` de `GET /auth/yo` (y del ingreso) lo avisa para que la interfaz la lleve a cambiarla. Las claves nunca salen por la API ni se escriben en la auditoría (solo quién cambió o restableció la clave de quién y cuántas sesiones se cerraron). Antes de usarlo en una base existente: `npm run db:migrate -w apps/api` (migración 0008).

**Versiones** ([ADR-005](docs/adr/0005-versionado-y-restauracion.md)): el historial solo crece. Restaurar crea una versión nueva que apunta al mismo archivo, y dos personas versionando a la vez reciben números consecutivos porque la transacción bloquea el documento. Si actualizas desde una versión anterior, aplica antes `npm run db:migrate -w apps/api` (migración 0004).

**Búsqueda** ([ADR-007](docs/adr/0007-busqueda-por-texto-completo.md)): `GET /documentos?q=interventoria` encuentra «Interventoría» en el título, el expediente o el texto de la versión vigente, con la raíz del español (singular y plural, conjugaciones). Exige todas las palabras; lo escrito es solo texto, no operadores. Se indexan los primeros 300 000 caracteres del texto de cada documento. Antes de usarla en una base existente: `npm run db:migrate -w apps/api` (migración 0006, que rellena lo que ya había).

**Verificación doble de duplicados** ([ADR-006](docs/adr/0006-verificacion-doble-de-duplicados.md)): al cargar, el servidor compara la huella SHA-256 con todo lo que ya existe y, si hay capa de texto, la similitud del texto. Un archivo idéntico se rechaza (409 `duplicado_exacto`, con dónde está). Uno muy parecido (probable reescaneo) responde 409 `duplicado_probable` con los candidatos; la persona **reenvía el mismo archivo** con `decision=nueva_version` (más `documentoId` y `motivo`) o `decision=documento_distinto` (más `justificacion`). La similitud nunca bloquea sola, y cada decisión queda en la auditoría (`decision_duplicado`). Un PDF sin capa de texto o con menos de 50 palabras se marca `sin_texto` y solo se verifica por huella. El umbral es `UMBRAL_SIMILITUD` (0,80 por defecto; [POR VERIFICAR] contra PDF reales). Antes de usar esto en una base existente: `npm run db:migrate -w apps/api` (migración 0005).

**Dónde se guardan los PDF** ([ADR-004](docs/adr/0004-almacen-de-archivos-y-carga.md)): `ALMACEN_TIPO=disco` (por defecto, la carpeta `apps/api/almacen-local`, sin Docker) o `ALMACEN_TIPO=s3` (el almacén de `npm run infra:up`, y en la nube Cloud Storage; exige las variables `S3_*`). La carga guarda el archivo y después el registro en una transacción; si algo falla no queda ninguno de los dos. `npm run almacen:huerfanos -w apps/api` lista los archivos que ninguna versión usa y, con `-- --borrar`, borra los de más de una hora.

**Cuadro de clasificación desde un CSV** ([ADR-010](docs/adr/0010-importacion-del-cuadro-por-comando.md)): es un comando, no un endpoint (nadie lo cambia por la API). Valida **todo** el archivo antes de escribir y, sin `--aplicar`, **solo muestra lo que haría**: no cambia ni el cuadro ni la auditoría.

```
npm run ccd:importar -w apps/api -- docs/ejemplos/cuadro-ejemplo.csv                       # solo muestra (simulación)
npm run ccd:importar -w apps/api -- docs/ejemplos/cuadro-ejemplo.csv --aplicar             # escribe, en una transacción
npm run ccd:importar -w apps/api -- docs/ejemplos/cuadro-ejemplo.csv --aplicar --eliminar-ausentes
```

| Opción | Qué hace |
|---|---|
| (ninguna) | Simulación: lista las series y subseries que se crearían, los nombres que cambiarían, las que se moverían y las que el archivo no menciona. Sale con 0, o con 1 si lo pedido chocaría con documentos |
| `--aplicar` | Escribe todo en **una sola transacción**: o queda el cuadro completo o no cambia nada. Registra un evento `ccd_importado` (sin usuario) con el nombre y la huella SHA-256 del archivo. Repetir el mismo archivo no cambia nada |
| `--eliminar-ausentes` | Además elimina lo que está en la base y no en el archivo, **salvo lo que tenga documentos** (esas se conservan y se informan). Sin esta opción, lo ausente solo se informa |

**Formato del CSV** (UTF-8, coma o punto y coma; un ejemplo ficticio en [`docs/ejemplos/cuadro-ejemplo.csv`](docs/ejemplos/cuadro-ejemplo.csv)): columnas `codigo`, `nombre` y `codigo_padre`. Padre vacío = serie; con padre = subserie de esa serie (el cuadro tiene dos niveles). Cada padre debe tener su propia fila en el mismo archivo.

```
codigo,nombre,codigo_padre
100,Gestión contractual,
100.1,Contratos de obra,100
100.2,Interventoría,100
```

Excel guarda por defecto en ANSI y se pierden las tildes: guárdalo como **«CSV UTF-8 (delimitado por comas)»**; el comando rechaza otra codificación con ese mismo aviso. Los códigos admiten letras, números y `.` `-` `_` entre ellos (máximo 32 caracteres; `100`, `100.1` o `GC-01`). Se compara por **código**: uno nuevo se crea, uno existente solo cambia de nombre, y **nunca se mueve ni se elimina una subserie que ya tiene documentos** (mover una con documentos, o cambiar un código de serie a subserie, se niega y no se escribe nada). Errores del archivo: salen todos juntos, cada uno con su línea, y no se escribe nada. Salida: 0 correcto; 1 archivo inválido o en conflicto; 2 uso incorrecto. En un contenedor: `node apps/api/dist/ccd/importar/importar-cli.js /ruta/cuadro.csv`; ver [`docs/despliegue.md`](docs/despliegue.md), sección 9.

La configuración sale de variables de entorno que se validan al arrancar (`apps/api/src/config/entorno.ts`). Si falta o es inválida alguna, la API no arranca y dice cuál corregir, sin mostrar sus valores. En local se leen del `.env` de la raíz.

| Comando (desde la raíz) | Qué hace |
|---|---|
| `npm run lint` | Oxlint con tipos |
| `npm test` | Pruebas unitarias (no necesitan base de datos) |
| `npm run test:e2e` | Pruebas de integración contra PostgreSQL real (requieren `npm run infra:up`). Usan una base aparte, `faro_test`, que se crea sola: nunca tocan la de desarrollo |
| `npm run build` | Compila a `apps/api/dist` |
| `npm run db:generate -w apps/api -- --name <nombre>` | Genera una migración SQL nueva a partir de `esquema.ts` |

**Pruebas de aceptación.** `apps/api/test/aceptacion.e2e-spec.ts` repite contra la API nueva las 7 del prototipo v1 (`legacy/prototipo-v1/test/flujo.test.js`), encadenadas como allá: credenciales y sesión, carga con búsqueda sin tildes y versión, rol de consulta, archivo ya digitalizado, no-PDF y datos incompletos, auditoría solo para el administrador y **persistencia tras reiniciar la aplicación** (cierra la instancia y levanta otra contra la misma base y el mismo almacén). Cambios respecto a v1, a propósito: la API responde con códigos y JSON (sin sesión es 401, no una redirección a `/login`) y un archivo que no es PDF es 415, no 400. Los servicios de versiones y de duplicados tienen además pruebas unitarias con repositorio falso (`*.service.spec.ts`).

Las migraciones están en `apps/api/drizzle/`. Se versionan en git y no se editan una vez fusionadas: un cambio de esquema es una migración nueva.

## Integración continua

`.github/workflows/ci.yml` corre en cada PR y en cada cambio de `main`, con cinco trabajos:

| Trabajo | Qué comprueba |
|---|---|
| `api` | `npm ci`, lint, pruebas unitarias, build, migraciones sobre una base vacía y pruebas de integración contra PostgreSQL |
| `legacy` | Las 7 pruebas del prototipo v1 |
| `infra` | Que `infra/docker-compose.yml` sea válido con las variables de ejemplo |
| `imagen` | Que el `Dockerfile` de la API compile y la imagen no corra como administrador ni traiga pruebas, fuentes ni `.env` |
| `secretos` | gitleaks sobre **todo el historial** (el repositorio es público); lo permitido está en `.gitleaks.toml`, cada excepción con su justificación |

Si un paso falla, el PR queda en rojo. `main` exige que pasen `api`, `legacy` e `infra` antes de fusionar; `imagen` y `secretos` también corren en cada PR, pero la protección de la rama aún no los exige (es un ajuste del repositorio, no de este código). Las acciones de GitHub se fijan por commit (SHA), no por etiqueta.

## Despliegue en la nube y contenedor

La API se empaqueta en una imagen (`apps/api/Dockerfile`, contexto: la raíz del repositorio) y hay un flujo manual de despliegue a Google Cloud Run (`.github/workflows/deploy.yml`, inactivo hasta que existan sus variables). El guion completo, con lo que necesita cuentas de Google Cloud y Neon, está en [`docs/despliegue.md`](docs/despliegue.md).

```
docker build -f apps/api/Dockerfile -t faro-api .
docker run --rm -e DATABASE_URL=... faro-api node apps/api/dist/base-datos/migrar-cli.js         # migrar (la API no migra al arrancar)
docker run --rm -e DATABASE_URL=... -e ADMIN_USUARIO=... -e ADMIN_CLAVE=... faro-api node apps/api/dist/semilla/crear-administrador.js   # primer administrador (sirve en producción)
```

Fuera de un contenedor, los mismos comandos son `node dist/base-datos/migrar-cli.js` y `node dist/semilla/crear-administrador.js` (tras `npm run build`). `db:seed` crea usuarios de demostración con una clave conocida y **se niega a correr con `NODE_ENV=production`**.

## Prototipo v1

Sigue funcionando por separado. Instrucciones en [`legacy/prototipo-v1/README.md`](legacy/prototipo-v1/README.md).

## Flujo de trabajo

Una rama por issue (`feat/<n>-...`, `fix/<n>-...`, `chore/<n>-...`), commits convencionales y PR con `Closes #<n>`. Detalle en `docs/PLAN_MEJORA.md`, sección 6.
