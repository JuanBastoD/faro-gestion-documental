# Cómo trabajamos en este repositorio

Proyecto de clase (Proyecto Integrador AR, Universidad de Pamplona, 2026-2P): sistema de gestión documental para la E.I.C.E. Faro del Catatumbo S.A.S. Esta guía resume el flujo de `docs/PLAN_MEJORA.md` (secciones 6.2 a 6.4).

## Reglas que no se negocian

- **El repositorio es público.** Nunca se suben datos reales de la entidad, datos personales, contraseñas, claves ni archivos `.env`. En la nube y en las pruebas solo hay datos ficticios.
- **Los commits llevan la fecha real.** No se retrodatan commits ni registros.
- **`main` solo recibe cambios por pull request**, con el CI en verde. Está protegida: no admite cambios directos, force push ni borrado.

## Flujo de un cambio

1. **Issue.** Todo cambio parte de un issue creado con una de las plantillas (historia, tarea, bug o decisión).
2. **Rama** desde `main` actualizada.
3. **Commits** pequeños, con el formato de abajo.
4. **Pull request** con la plantilla. Debe cerrar el issue con `Closes #<n>`.
5. **CI en verde.** `api`, `legacy` e `infra` deben pasar.
6. **Fusión con squash** y se borra la rama. El título del PR pasa a ser el mensaje del commit en `main`, por eso debe seguir el formato de commits.

```
git checkout main && git pull
git checkout -b feat/12-verificacion-doble
# ...trabajo, pruebas...
git push -u origin feat/12-verificacion-doble
gh pr create        # usa la plantilla; incluye "Closes #12"
```

### Ramas

`<tipo>/<n>-descripcion-corta`, donde `<n>` es el número del issue y la descripción va en minúsculas, sin tildes y con guiones.

| Prefijo | Para |
|---|---|
| `feat/` | Funcionalidad nueva |
| `fix/` | Corrección de un bug |
| `chore/` | Infraestructura, dependencias, CI, mantenimiento |
| `docs/` | Documentación y ADR |

Ejemplos: `feat/6-esqueleto-api`, `chore/2-docker-compose`, `docs/5-adr`.

### Commits convencionales

```
<tipo>(<ámbito>): <resumen en minúsculas y en presente, sin punto final>

<cuerpo opcional: qué cambia y por qué, no cómo>
```

- **Tipos:** `feat`, `fix`, `docs`, `chore`, `test`, `refactor`, `ci`.
- **Ámbitos habituales:** `api`, `web`, `infra`, `db`, `ci`, `docs`. El ámbito es opcional.
- Resumen de unas 70 letras como máximo. Si hay un issue, el cuerpo termina con `Closes #<n>`.

Ejemplos reales de este repositorio:

```
chore(infra): Docker Compose con PostgreSQL y almacén S3
feat(api): esqueleto de la API con /health, configuración validada y migración inicial
chore(ci): flujo de GitHub Actions con lint, pruebas y build
```

## Issues

### Plantillas

| Plantilla | Cuándo | Etiqueta que aplica |
|---|---|---|
| Historia de usuario | Una funcionalidad vista desde quien la usa | `tipo:historia` |
| Tarea técnica | Infraestructura, CI, refactorización, documentación | `tipo:tarea` |
| Bug | Algo no funciona como debería | `tipo:bug` |
| Decisión (ADR o spike) | Hay que elegir entre opciones y registrar por qué | `tipo:decisión` |

### Etiquetas

- `tipo:` historia, tarea, bug, decisión, docs.
- `area:` api, web, infra, datos, seguridad, docs, pruebas.
- `prioridad:` **must** (sin esto no hay entrega), **should** (importante, hay alternativa), **could** (deseable).

Al clasificar un issue se le ponen su etiqueta `area:`, su etiqueta `prioridad:`, el responsable y el hito.

### Definición de listo

Un issue puede empezar a trabajarse cuando tiene:

- criterios de aceptación escritos y verificables;
- estimación en horas;
- responsable;
- hito.

### Definición de terminado

Un issue está terminado cuando:

- el código está fusionado en `main`;
- las pruebas están en verde;
- la documentación afectada está actualizada;
- está desplegado en el entorno de pruebas, si aplica;
- hay una entrada en la bitácora.

## Tablero y hitos

El tablero del proyecto es <https://github.com/users/JuanBastoD/projects/2>. Las tarjetas se mueven así:

| Columna | Cuándo |
|---|---|
| Backlog | El issue existe pero aún no cumple la definición de listo |
| Listo para el sprint | Cumple la definición de listo |
| En progreso | Se abrió la rama |
| En revisión | Se abrió el PR |
| Hecho | Se cerró el issue |

Los hitos de la reconstrucción son `V2-M1` a `V2-M4` (fechas en `docs/PLAN_MEJORA.md`, sección 7.2). Cada semana se eligen los issues, con un máximo igual a las horas disponibles, se revisa el tablero a mitad de semana y al cierre se registra en la bitácora qué pasó a "Hecho".

## Revisión

El código lo escribe y lo fusiona una sola persona; lo valida el CI. No se simula una revisión de código que no ocurre, y por eso `main` no exige aprobaciones. Si más adelante hay un segundo desarrollador, se activa la aprobación obligatoria.

## Decisiones de diseño (ADR)

Toda decisión importante queda registrada en `docs/adr/` como un archivo `NNNN-titulo-corto.md`, con **fecha, estado, contexto, decisión, alternativas descartadas y consecuencias**. Un ADR aceptado no se reescribe: si la decisión cambia, se escribe un ADR nuevo que declara que reemplaza al anterior.

## Base de datos

Un cambio de esquema es una **migración nueva** en `apps/api/drizzle/` (se genera con `npm run db:generate -w apps/api -- --name <nombre>`). Una migración ya fusionada no se edita.

## Pruebas locales

```
cp .env.example .env
npm run infra:up      # PostgreSQL y almacén S3 en Docker
npm ci
npm run lint
npm run typecheck     # tsc --noEmit sobre src/ y test/
npm test              # unitarias
npm run test:e2e      # integración, requiere infra:up
npm run build
```

Es lo mismo que ejecuta el CI. El detalle del entorno local está en el [README](README.md).

## Versiones

Etiquetas: `v0.1.0` (prototipo v1), `v2.0.0-alpha` y `v2.0.0`. Los cambios visibles para quien usa el sistema se anotan en `CHANGELOG.md`.
