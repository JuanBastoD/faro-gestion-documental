# Faro · Gestión documental

Sistema de gestión documental para la E.I.C.E. Faro del Catatumbo S.A.S. Proyecto de clase (Proyecto Integrador AR, Universidad de Pamplona, 2026-2P). Usa únicamente **datos ficticios**. No es un SGDEA en producción.

## Estructura del monorepo

| Carpeta | Contenido | Estado |
|---|---|---|
| `apps/api` | API REST (NestJS, PostgreSQL) | En construcción (hito V2-M1) |
| `apps/web` | Interfaz web (React + Vite) | En construcción (hito V2-M4): ingreso, listado con búsqueda y detalle; carga y administración, pendientes |
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
| `GET /auth/yo` | Con sesión | Devuelve quién tiene la sesión |
| `POST /auth/logout` | Con sesión | Cierra la sesión |
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
| `GET /auditoria` | Administrador | Eventos de auditoría, los más recientes primero. Filtros: `usuarioId`, `accion`, `documentoId`, `desde`, `hasta`; paginación: `pagina` y `tamano` (máx. 100). Solo lectura: los eventos no se editan ni se borran, ni por la API ni por SQL |

**Versiones** ([ADR-005](docs/adr/0005-versionado-y-restauracion.md)): el historial solo crece. Restaurar crea una versión nueva que apunta al mismo archivo, y dos personas versionando a la vez reciben números consecutivos porque la transacción bloquea el documento. Si actualizas desde una versión anterior, aplica antes `npm run db:migrate -w apps/api` (migración 0004).

**Búsqueda** ([ADR-007](docs/adr/0007-busqueda-por-texto-completo.md)): `GET /documentos?q=interventoria` encuentra «Interventoría» en el título, el expediente o el texto de la versión vigente, con la raíz del español (singular y plural, conjugaciones). Exige todas las palabras; lo escrito es solo texto, no operadores. Se indexan los primeros 300 000 caracteres del texto de cada documento. Antes de usarla en una base existente: `npm run db:migrate -w apps/api` (migración 0006, que rellena lo que ya había).

**Verificación doble de duplicados** ([ADR-006](docs/adr/0006-verificacion-doble-de-duplicados.md)): al cargar, el servidor compara la huella SHA-256 con todo lo que ya existe y, si hay capa de texto, la similitud del texto. Un archivo idéntico se rechaza (409 `duplicado_exacto`, con dónde está). Uno muy parecido (probable reescaneo) responde 409 `duplicado_probable` con los candidatos; la persona **reenvía el mismo archivo** con `decision=nueva_version` (más `documentoId` y `motivo`) o `decision=documento_distinto` (más `justificacion`). La similitud nunca bloquea sola, y cada decisión queda en la auditoría (`decision_duplicado`). Un PDF sin capa de texto o con menos de 50 palabras se marca `sin_texto` y solo se verifica por huella. El umbral es `UMBRAL_SIMILITUD` (0,80 por defecto; [POR VERIFICAR] contra PDF reales). Antes de usar esto en una base existente: `npm run db:migrate -w apps/api` (migración 0005).

**Dónde se guardan los PDF** ([ADR-004](docs/adr/0004-almacen-de-archivos-y-carga.md)): `ALMACEN_TIPO=disco` (por defecto, la carpeta `apps/api/almacen-local`, sin Docker) o `ALMACEN_TIPO=s3` (el almacén de `npm run infra:up`, y en la nube Cloud Storage; exige las variables `S3_*`). La carga guarda el archivo y después el registro en una transacción; si algo falla no queda ninguno de los dos. `npm run almacen:huerfanos -w apps/api` lista los archivos que ninguna versión usa y, con `-- --borrar`, borra los de más de una hora.

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

## Interfaz web (`apps/web`)

React 19, Vite y TypeScript, con React Router y CSS propio (sin bibliotecas de componentes ni fuentes externas; [ADR-012](docs/adr/0012-interfaz-web-bajo-app-servida-por-la-api.md)). La interfaz vive bajo **`/app/`**: las rutas de la API (`/auth`, `/series`, `/documentos`, `/usuarios`, `/auditoria`, `/health`) no se movieron.

Pantallas de esta entrega: **ingreso** y cierre de sesión, **listado** de documentos con búsqueda por texto, filtro por serie y paginación (la búsqueda, la serie y la página quedan en la URL, así que se pueden compartir), **detalle** con el historial de versiones y la descarga de cualquiera de ellas, y las de **carga** (issue #24, ver abajo). El menú depende del rol: consulta solo ve «Documentos»; administrador y editor ven además «Cargar documento»; el administrador ve también «Usuarios» y «Auditoría». Las pantallas de usuarios y auditoría (issue #25) son por ahora un marcador que lo dice.

**Cargar y versionar documentos** (administrador y editor; el rol de consulta no ve los enlaces ni entra por la dirección, y la API lo rechaza con 403 de todos modos):

- **Cargar un documento** (`/app/documentos/nuevo`, enlace «Cargar documento» del menú): se elige el PDF (la interfaz avisa antes de enviar si no es PDF o si pasa de 20 MB; la API vuelve a validar el contenido) y se escriben título, expediente, subserie (solo las subseries admiten documentos), fecha del documento y, si se quiere, el motivo. Mientras sube, el formulario queda deshabilitado y no se puede enviar dos veces; los errores salen en español, con el campo señalado y el foco puesto en él.
- **Archivo idéntico** (409 `duplicado_exacto`): no se puede cargar. La pantalla dice dónde está (documento, versión, expediente y subserie), por qué no se admite y enlaza al documento.
- **Duplicado probable** (409 `duplicado_probable`, [ADR-006](docs/adr/0006-verificacion-doble-de-duplicados.md)): aparece una pantalla que muestra **lado a lado** (apilados en el celular) el documento que ya existe (título, expediente, subserie, fecha, versión parecida, quién y cuándo la cargó, porcentaje de parecido y enlaces para verlo y descargarlo) y el archivo que se intenta cargar (nombre, tamaño y datos escritos, con un enlace que abre el PDF nuevo en otra pestaña). Si hay varios documentos parecidos, se elige con cuál comparar. Las decisiones, cada una con la explicación de lo que pasará: **«es el mismo documento»** (no se guarda nada y se lleva al documento existente), **«es una versión nueva de…»** (se reenvía el archivo con `decision=nueva_version`, `documentoId` y un motivo obligatorio) y **«es otro documento»** (se reenvía con `decision=documento_distinto` y una justificación obligatoria, que queda en la auditoría). El PDF no se incrusta en la página: la política de contenido de la API no lo admite.
- **Versión nueva** (`/app/documentos/:id/version`, botón «Subir una versión nueva» del detalle): PDF y motivo obligatorio de hasta 300 caracteres, con contador. Si el contenido ya está en una versión de ese documento, dice en cuál (409). Al terminar vuelve al detalle con la versión nueva y un aviso.
- **Restaurar** (botón «Restaurar» de cada versión anterior en el historial): pide confirmación y explica que se crea una versión nueva y que no se borra nada; el motivo es opcional. Si la vigente ya tiene ese contenido, lo dice (409).
- **Mensajes de error**: un solo módulo (`apps/web/src/api/errores.ts`) traduce cada código de la API (400 con el campo, 401, 403, 404, 409, 413, 415, 422, 429, 5xx y falta de red) a un mensaje que dice qué pasó y qué hacer; ninguna pantalla muestra el texto crudo del servidor.

**En desarrollo** (la API en marcha, por ejemplo con `npm run start:dev -w apps/api`):

```
npm run dev -w apps/web            # http://localhost:5173/app/
```

Vite reenvía a la API (`http://127.0.0.1:3000`) las rutas de la API. Si la API corre en otro puerto: `FARO_API_URL=http://127.0.0.1:3121 npm run dev -w apps/web` (en PowerShell, `$env:FARO_API_URL='http://127.0.0.1:3121'` antes del comando). El proxy conserva el encabezado `Host` original a propósito: la guarda de origen de la API ([ADR-009](docs/adr/0009-seguridad-minima-para-exponer-la-api.md)) compara `Origin` con `Host` y, si Vite lo reescribiera, rechazaría el ingreso con 403.

**Compilada y servida por la API** (así corre en el contenedor y en la nube):

```
npm run build                      # compila la API y la interfaz (apps/web/dist)
node apps/api/dist/main.js         # la interfaz queda en http://127.0.0.1:3000/app/
```

Si existe `apps/web/dist`, la API la sirve en `/app/` con respaldo a `index.html` para las rutas de la interfaz; `GET /` redirige a `/app/`. Si no existe, la API arranca igual y `GET /` sigue dando 404 como antes. `INTERFAZ_RUTA` (opcional) apunta a otra carpeta compilada. El `Dockerfile` de la API ya compila la interfaz y la copia a la imagen.

**Usuarios de demostración.** Con `npm run db:seed -w apps/api` existen `admin.demo`, `editor.demo` y `consulta.demo` (todos ficticios); la clave es el valor de `SEMILLA_CLAVE` en tu `.env`.

| Comando (desde la raíz) | Qué hace |
|---|---|
| `npm run dev -w apps/web` | Servidor de desarrollo con recarga |
| `npm test -w apps/web` | Pruebas de la interfaz (Vitest, Testing Library y jsdom; la API se simula a nivel de `fetch`) |
| `npm run typecheck -w apps/web` | Comprobación de tipos |
| `npm run lint -w apps/web` | Oxlint con tipos y reglas de accesibilidad |

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
