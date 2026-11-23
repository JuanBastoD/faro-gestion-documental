# ADR-001: Stack tecnológico de la versión 2

- **Fecha:** 22 de noviembre de 2026
- **Estado:** Aceptada al fusionar este documento
- **Issue:** #5
- **Reemplaza a:** nada (la propuesta inicial está en `docs/PLAN_MEJORA.md`, sección 2, del 11 de noviembre de 2026)
- **Etiquetas de certeza:** [CONFIRMADO] construido y verificado en el repositorio; [PROPUESTA] decidido pero aún no construido; [POR VERIFICAR] depende de un dato que falta.

## 1. Contexto

El prototipo v1 (`legacy/prototipo-v1/`, tag `v0.1.0`) mezcla rutas, reglas y SQL en una sola capa, usa SQLite local, guarda los PDF en disco y las sesiones en memoria. Eso sirve para una demostración en un solo equipo y no para centralizar la información de la entidad (diagnóstico completo en el plan, sección 1).

Restricciones que condicionan la elección:

- **Un solo desarrollador** (Juan) y 15 días hasta el cierre del curso (7 de diciembre de 2026). Cada herramienta nueva cuesta tiempo que no hay.
- **Volumen bajo** [SUPUESTO]: 8 funcionarios, 21 contratistas y 53 procesos en trámite en lo corrido del año. No hay línea base de volumen documental que lo confirme.
- **Requisitos funcionales que mandan sobre el stack:** búsqueda de texto en español, verificación de duplicados por huella y por similitud de texto, historial de versiones y auditoría.
- **Despliegue de pruebas gratuito** (hay tarjeta para GCP) y **sin atarse a un proveedor**: el código debe poder moverse de nube cambiando un adaptador.
- **Repositorio público y datos ficticios**: nada de secretos en el código ni datos reales.
- **Alcance:** esto es un entorno de pruebas del proyecto de clase, no infraestructura institucional (Track 3 sigue aparte).

## 2. Decisión

| Capa | Elección | Estado |
|---|---|---|
| Lenguaje | TypeScript 6.0.3 en API y web | [CONFIRMADO] |
| Entorno de ejecución | Node.js 22.13 o superior (el CI y el desarrollo usan 24) | [CONFIRMADO] |
| API | NestJS 12.6 (ESM, Express), monolito modular (ver ADR-002) | [CONFIRMADO] |
| Base de datos | PostgreSQL 17 | [CONFIRMADO] |
| Acceso a datos y migraciones | Drizzle ORM 0.45 con `drizzle-kit`, migraciones SQL versionadas en `apps/api/drizzle/` | [CONFIRMADO] |
| Configuración | Variables de entorno validadas con zod 4 al arrancar | [CONFIRMADO] |
| Archivos | Interfaz `AlmacenArchivos` sobre la API S3. Local: RustFS 1.0.6. Nube: Cloud Storage | Local [CONFIRMADO]; adaptador y nube [PROPUESTA] |
| Pruebas | Vitest 4 y Supertest: unitarias sin base de datos e integración contra PostgreSQL real | [CONFIRMADO] |
| Análisis estático | Oxlint con análisis de tipos | [CONFIRMADO] |
| Contenedores locales | Docker Compose (PostgreSQL y almacén S3) | [CONFIRMADO] |
| Integración continua | GitHub Actions, con las acciones fijadas por SHA | [CONFIRMADO] |
| Repositorio | Monorepo con npm workspaces | [CONFIRMADO] |
| Interfaz web | React con Vite y TypeScript (`apps/web`, hito V2-M4) | [PROPUESTA] |
| Despliegue de pruebas | GCP Cloud Run, Neon (PostgreSQL) y Cloud Storage | [PROPUESTA] [POR VERIFICAR] cuotas gratuitas el día del despliegue |

Versiones tomadas de `package-lock.json` al 22 de noviembre de 2026. Las imágenes de Docker están fijadas en `infra/docker-compose.yml` (`postgres:17-alpine`, `rustfs/rustfs:1.0.6`); no se usa `latest`.

### Por qué cada elección

- **TypeScript en todo:** un solo lenguaje para API y web y tipos compartidos, que es lo que un desarrollador solo puede mantener.
- **NestJS:** impone módulos, inyección de dependencias y validación de forma estándar, lo que se explica fácil ante el docente y evita repetir el problema del prototipo (Express a mano sin estructura).
- **PostgreSQL:** estándar de servidor, con búsqueda de texto completo en español (`tsvector`). Se había previsto `pg_trgm` para la similitud de duplicados; la medición de #12 lo descartó (ver ADR-006).
- **Drizzle:** el esquema se escribe en TypeScript, no hay un paso aparte de generación de cliente y el SQL de cada migración queda visible y editable (útil para índices de texto y extensiones). No se eligió por una medición: Prisma también habría servido.
- **Archivos tras una interfaz S3:** la API habla S3 estándar, así que el mismo adaptador sirve con cualquier almacén compatible y mover el despliegue es cambiar configuración.
- **Vitest y Oxlint:** son los de la plantilla oficial de NestJS 12 y funcionan con módulos ESM sin configuración adicional. Esa fue la razón principal; no se compararon en rendimiento.
- **TypeScript 6.0.3 y no 7:** `ts-jest` declara compatibilidad con `typescript <7` y `typescript-eslint` con `typescript <6.1.0` (rangos de sus dependencias de pares, consultados el 22 de noviembre). La plantilla de NestJS 12 también usa la serie 6.

## 3. Alternativas descartadas

| Tema | Alternativa | Motivo del descarte |
|---|---|---|
| Lenguaje y marco | Java con Spring Boot | Más pesado para un solo desarrollador y poco tiempo; dos lenguajes si la interfaz es web |
| API | Express sin estructura (como el prototipo) | Es lo que originó el problema de mezclar capas |
| Base de datos | SQLite | Un solo proceso y un solo equipo; no sirve en la nube |
| Base de datos | Firestore | Amarra a Google y no tiene SQL |
| Acceso a datos | Prisma | Viable. Se prefirió Drizzle por el SQL visible y por no tener generación de cliente; no por una limitación de Prisma |
| Acceso a datos | SQL suelto con `pg` y un migrador propio | Más código propio que mantener y sin tipos |
| Archivos | MinIO | Sus imágenes oficiales ya no se publican: `minio/minio` en Docker Hub devuelve `object not found` y Quay no tiene manifiestos públicos (verificado el 22 de nov.) |
| Archivos | Garage o SeaweedFS | Disponibles, pero con más pasos de configuración; no se probaron |
| Archivos | Disco local | Se pierde al redesplegar un contenedor |
| Pruebas | Jest con `ts-jest` | `ts-jest` limita TypeScript a menos de 7, y el soporte de módulos ESM en Jest requiere configuración adicional [no se probó en este proyecto] |
| Despliegue | Azure como primera opción | Crédito de 30 días y más difícil de mantener gratis después; el código queda portable de todos modos |
| Interfaz | Plantillas EJS en el servidor (como el prototipo) | No hay contrato de API reutilizable para otro cliente ni para integraciones futuras con SIA y SECOP |
| Despliegue | Todo en Docker en un PC | Útil como respaldo de la demo sin internet, no como despliegue |

## 4. Consecuencias

**A favor**

- Un solo lenguaje, esquema y migraciones reproducibles, y un entorno local idéntico para cualquiera (`npm run infra:up`).
- El CI valida lo mismo que se corre en local y ya cubre la integración contra un PostgreSQL real.
- Cambiar de nube es cambiar un adaptador y la configuración, no reescribir.

**En contra y riesgos**

- **TypeScript queda fijado en la serie 6** hasta que `ts-jest` o `typescript-eslint` admitan la 7. Hay que revisarlo al actualizar dependencias.
- **Drizzle es anterior a la versión 1.0** (0.45): su API puede cambiar. Se mitiga con la versión fijada en el lockfile y con que el acceso a datos vive solo en los repositorios (ADR-002).
- **Oxlint tiene menos reglas y complementos que ESLint.** Todavía no hay formateador de código configurado.
- **RustFS es un proyecto joven** (serie 1.0) [POR VERIFICAR su madurez]. Se usa solo en local; en la nube el almacén es Cloud Storage, así que el riesgo no llega al entorno de pruebas desplegado.
- **Cuotas y arranques en frío:** Cloud Run y Neon pueden tardar de 1 a 3 segundos en la primera petición tras inactividad [POR VERIFICAR]. Las cuotas gratuitas cambian: se confirman en la página oficial el día de desplegar, y se configura una alerta de presupuesto antes.
- **Un solo desarrollador:** el conocimiento está en una persona. La documentación (`README`, `CONTRIBUTING`, estos ADR) y el CI compensan una parte.

## 5. Decisiones que este ADR no cubre

Quedan para su propio registro cuando se aborden:

- Mecanismo de autenticación (sesión o JWT en cookie `httpOnly`) y de protección contra CSRF (#8 y #18).
- Librería de extracción de texto de los PDF y umbral de similitud (#12): resuelto en el ADR-006 (`unpdf` y una firma MinHash; `pg_trgm` se midió y se descartó). El umbral inicial se calibra con PDF reales, que requieren autorización de la entidad.
- Estructura de la interfaz web y su biblioteca de componentes (#23 a #25).
- Estrategia de base de datos de pruebas aparte, antes de que las pruebas de integración escriban filas.

## 6. Referencias

- `docs/PLAN_MEJORA.md`, secciones 2, 3 y 9 (decisiones 8 a 12).
- PR #29 (Compose y RustFS), PR #30 (esqueleto de la API) y PR #31 (CI).
- Rangos de dependencias de pares de `ts-jest` y `typescript-eslint`, consultados con `npm view` el 22 de noviembre de 2026.
