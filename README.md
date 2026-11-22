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

## Prototipo v1

Sigue funcionando por separado. Instrucciones en [`legacy/prototipo-v1/README.md`](legacy/prototipo-v1/README.md).

## Flujo de trabajo

Una rama por issue (`feat/<n>-...`, `fix/<n>-...`, `chore/<n>-...`), commits convencionales y PR con `Closes #<n>`. Detalle en `docs/PLAN_MEJORA.md`, sección 6.
