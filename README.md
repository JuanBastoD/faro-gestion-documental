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

```
npm run db:seed -w apps/api      # migra y crea admin.demo, editor.demo, consulta.demo y el cuadro de clasificación (ficticios)
```

La clave de esos usuarios es `SEMILLA_CLAVE` de tu `.env`. La siembra se niega a correr con `NODE_ENV=production`.

| Ruta | Quién | Qué hace |
|---|---|---|
| `POST /auth/login` | Cualquiera | Recibe `{ usuario, clave }` y pone la cookie `faro_sesion` |
| `GET /auth/yo` | Con sesión | Devuelve quién tiene la sesión |
| `POST /auth/logout` | Con sesión | Cierra la sesión |
| `GET /series` | Con sesión | Cuadro de clasificación como árbol de dos niveles (series y subseries). Solo las subseries admiten documentos; lo impone el servicio y la base de datos |
| `GET /auditoria` | Administrador | Eventos de auditoría, los más recientes primero. Filtros: `usuarioId`, `accion`, `documentoId`, `desde`, `hasta`; paginación: `pagina` y `tamano` (máx. 100). Solo lectura: los eventos no se editan ni se borran, ni por la API ni por SQL |

La configuración sale de variables de entorno que se validan al arrancar (`apps/api/src/config/entorno.ts`). Si falta o es inválida alguna, la API no arranca y dice cuál corregir, sin mostrar sus valores. En local se leen del `.env` de la raíz.

| Comando (desde la raíz) | Qué hace |
|---|---|
| `npm run lint` | Oxlint con tipos |
| `npm test` | Pruebas unitarias (no necesitan base de datos) |
| `npm run test:e2e` | Pruebas de integración contra PostgreSQL real (requieren `npm run infra:up`). Usan una base aparte, `faro_test`, que se crea sola: nunca tocan la de desarrollo |
| `npm run build` | Compila a `apps/api/dist` |
| `npm run db:generate -w apps/api -- --name <nombre>` | Genera una migración SQL nueva a partir de `esquema.ts` |

Las migraciones están en `apps/api/drizzle/`. Se versionan en git y no se editan una vez fusionadas: un cambio de esquema es una migración nueva.

## Integración continua

`.github/workflows/ci.yml` corre en cada PR y en cada cambio de `main`, con tres trabajos:

| Trabajo | Qué comprueba |
|---|---|
| `api` | `npm ci`, lint, pruebas unitarias, build, migraciones sobre una base vacía y pruebas de integración contra PostgreSQL |
| `legacy` | Las 7 pruebas del prototipo v1 |
| `infra` | Que `infra/docker-compose.yml` sea válido con las variables de ejemplo |

Si un paso falla, el PR queda en rojo. `main` exige que los tres pasen antes de fusionar. Las acciones de GitHub se fijan por commit (SHA), no por etiqueta.

## Prototipo v1

Sigue funcionando por separado. Instrucciones en [`legacy/prototipo-v1/README.md`](legacy/prototipo-v1/README.md).

## Flujo de trabajo

Una rama por issue (`feat/<n>-...`, `fix/<n>-...`, `chore/<n>-...`), commits convencionales y PR con `Closes #<n>`. Detalle en `docs/PLAN_MEJORA.md`, sección 6.
