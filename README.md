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

## Prototipo v1

Sigue funcionando por separado. Instrucciones en [`legacy/prototipo-v1/README.md`](legacy/prototipo-v1/README.md).

## Flujo de trabajo

Una rama por issue (`feat/<n>-...`, `fix/<n>-...`, `chore/<n>-...`), commits convencionales y PR con `Closes #<n>`. Detalle en `docs/PLAN_MEJORA.md`, sección 6.
