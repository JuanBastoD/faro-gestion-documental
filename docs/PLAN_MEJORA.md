# Plan de mejora y escalamiento del prototipo SGD Faro (v2)

Fecha: 11 de noviembre de 2026. Estado: [PROPUESTA], pendiente de aprobación del equipo.
Reemplaza el orden de `PROXIMOS_PASOS.md` (usuarios, cuadro, pruebas), que sigue válido como lista de funciones pero no como arquitectura.

## 1. Diagnóstico del prototipo actual [CONFIRMADO, leído en el código]

No es un solo archivo, pero sí una sola capa: ~2.300 líneas donde cada ruta de `src/app.js` mezcla HTTP, reglas de negocio, SQL y archivos.

| Problema | Dónde | Consecuencia |
|---|---|---|
| Rutas, reglas y SQL en la misma capa | `app.js`, `documentos.js` | No se puede probar ni cambiar una parte sin tocar las demás |
| SQLite en un archivo local (`node:sqlite`) | `db.js` | Un solo proceso, un solo equipo; no sirve en la nube |
| PDF en disco local | `documentos.js` (`insertarVersion`) | Se pierde al redesplegar un contenedor |
| Sesiones en memoria | `app.js` | Cada reinicio cierra sesiones; no escala a 2 instancias |
| Sin migraciones (`CREATE IF NOT EXISTS`) | `schema.sql` | No se puede evolucionar el esquema sin borrar datos |
| Sin CSRF, sin límite de intentos de login, sin cabeceras de seguridad | `app.js` | Inaceptable fuera de localhost |
| `sha256` UNIQUE global | `schema.sql` | Impide restaurar una versión anterior (ya declarado) |
| Sin paginación, búsqueda con `LIKE` | `buscarDocumentos` | Lento con miles de documentos |
| Sin configuración por entorno, logs, Docker ni CI | todo | No se puede desplegar de forma repetible |
| Interfaz renderizada en servidor (EJS), sin API | `views/` | No hay contrato reutilizable (otro cliente, integraciones SIA/SECOP a futuro) |
| 1 archivo de pruebas, 7 casos | `test/` | Poca red de seguridad para refactorizar |

Lo que sí vale la pena conservar: el modelo de datos (series, documentos, versiones, auditoría), la huella SHA-256, los roles, la auditoría de accesos denegados y las pruebas del flujo como pruebas de aceptación.

## 2. Arquitectura propuesta [PROPUESTA]

**Monolito modular** con puertos y adaptadores. No microservicios: dos personas y un dominio pequeño; el costo operativo no se justifica y la modularidad deja la puerta abierta.

```
 Navegador ──► Frontend SPA (React + Vite) ──► API REST (NestJS, OpenAPI)
                                                  │
              ┌──────────────┬────────────────────┼───────────────┐
           módulo auth    módulo ccd          módulo documentos   módulo auditoría
           (usuarios,     (series/            (versiones,         (eventos,
            roles)         subseries)          huellas, búsqueda)  consulta)
                                                  │
                          Puertos: RepositorioDocumentos · AlmacenArchivos · Reloj
                                                  │
              ┌───────────────────────────────────┴──────────────────┐
         PostgreSQL (Prisma/Drizzle + migraciones)     Almacén de objetos (adaptador:
                                                        disco local | S3/MinIO | GCS | Azure Blob)
```

Capas por módulo: `controller` (HTTP y validación) → `service` (reglas de negocio) → `repository` (datos). Las reglas no conocen Express ni SQL.

### Stack [PROPUESTA]

| Capa | Elección | Por qué | Alternativa descartada |
|---|---|---|---|
| Lenguaje | TypeScript en todo | Un solo desarrollador (Juan), mismo lenguaje en API y web, tipos compartidos | Java/Spring: más pesado para 1 dev y poco tiempo |
| API | NestJS | Módulos, inyección de dependencias y validación estandarizados; fácil de explicar ante el docente | Express a mano: es lo que ya causó el problema |
| Base de datos | PostgreSQL | Estándar de servidor; búsqueda de texto completo en español (`tsvector`); portable entre nubes | SQLite (no escala), Firestore (amarra a Google, sin SQL) |
| Acceso a datos | Prisma o Drizzle con migraciones versionadas | Esquema evolutivo y reproducible | SQL suelto |
| Archivos | Interfaz `AlmacenArchivos` con adaptadores | Mismo código en local (disco/MinIO) y nube (GCS/Blob) | Disco local |
| Autenticación | Sesión o JWT con cookie httpOnly, `argon2`, límite de intentos, CSRF | Mínimo decente para internet | Sesión en memoria |
| Frontend | React + Vite + TypeScript | API separada, reutilizable | EJS (ya hecho, sin contrato) |
| Empaquetado | Docker + `docker-compose` (api, db, minio) | Mismo entorno en cualquier equipo y nube | `iniciar-demo.bat` |
| CI/CD | GitHub Actions: lint, pruebas, build, despliegue | Evidencia de iteraciones para la rúbrica (repositorio y avances) | Despliegue manual |
| Pruebas | Vitest/Jest (unitarias de servicios), Supertest (API), Playwright (1 flujo e2e) | Pirámide con las 7 pruebas actuales como base de aceptación | Solo pruebas de flujo |
| Duplicados | SHA-256 más similitud de texto (`pg_trgm`) sobre la capa de texto del PDF/A | Detecta reescaneos, ver sección 5 | Solo SHA-256 |
| Repositorio | Monorepo con npm workspaces | Un cambio de API y su pantalla van juntos; ver sección 6 | Un repositorio por parte |

## 3. Despliegue gratuito [PROPUESTA; cuotas por verificar en la página oficial el día de desplegar]

Comparación de lo investigado (fuentes en la sección 7):

| Opción | Cómputo | Base de datos | Archivos | Veredicto |
|---|---|---|---|---|
| **GCP + Neon** (recomendada) | Cloud Run: contenedor, escala a cero, cuota gratuita mensual permanente | Neon Free (Postgres, ~1 GB, se suspende por inactividad) | Cloud Storage, 5 GB-mes gratis en regiones elegibles | Gratis de forma continua para un prototipo; la cuenta de GCP pide tarjeta |
| Azure | Cuenta nueva: $200 de crédito por 30 días y luego servicios gratuitos limitados | Servicios gratuitos por 12 meses; no verificado para PostgreSQL | Blob Storage | Más enredado para mantener gratis después del primer mes |
| Todo en Docker en un PC | Local | Local | Local | Útil como respaldo de demo sin internet, no como despliegue |

**Recomendación:** GCP Cloud Run + Neon + Cloud Storage. Como el código solo depende de contenedor, `DATABASE_URL` y la interfaz `AlmacenArchivos`, migrar a Azure (Container Apps + Blob) es cambiar un adaptador y la configuración, no reescribir. Eso responde a "algo gratis que nos deje desplegarlo" sin atarnos a un proveedor.

Riesgos [POR VERIFICAR]: cuota exacta de Cloud Run (las fuentes difieren), arranque en frío de Cloud Run y Neon (1 a 3 s la primera petición tras inactividad), y que Google pida tarjeta aunque no se cobre. Configurar alerta de presupuesto en $1 antes de desplegar.

## 4. Reglas de datos y alcance (para no romper CLAUDE.md)

- Un entorno de pruebas en la nube NO es infraestructura institucional. Se registra en la bitácora como "entorno de pruebas del proyecto de clase"; el servidor de la entidad sigue siendo Track 3.
- Solo datos ficticios en la nube. Documentos reales de la entidad requieren autorización escrita de la entidad (Ley 1581 de 2012, habeas data) [POR VERIFICAR con la entidad].
- El repositorio es público: secretos solo en variables de entorno y en el gestor de secretos de la nube; `.env` fuera de git.
- Los commits llevan fecha real; no se retrodatan.

## 5. Verificación doble de duplicados (SHA-256 + texto) [PROPUESTA]

Motivo: el hash solo detecta copias idénticas bit a bit, y un reescaneo del mismo papel genera otro archivo. Los PDF de la entidad se escanean con OCR y en PDF/A-1a, así que ya traen capa de texto. Además, PDF/A incrusta metadatos con fecha, y eso cambia el hash aunque el contenido sea el mismo.

1. **Extracción:** en la carga se extrae la capa de texto del PDF (no se corre OCR propio). Si no trae texto, el documento queda marcado "sin capa de texto" y solo se verifica por hash.
2. **Normalización:** minúsculas, sin tildes, sin signos ni espacios repetidos.
3. **Almacenamiento:** el texto normalizado se guarda por versión (`versiones.texto`) con índice `pg_trgm` y `tsvector`. El mismo texto alimenta la búsqueda por contenido.
4. **Decisión:**

| SHA-256 | Similitud de texto | Resultado |
|---|---|---|
| Igual | no aplica | Duplicado exacto: se bloquea y se indica dónde está |
| Distinto | ≥ umbral (inicial 90 %) | Probable reescaneo: aviso con comparación lado a lado; el usuario elige "nueva versión de ese documento" o "documento distinto" con justificación |
| Distinto | < umbral | Documento nuevo |

Reglas:
- La similitud nunca bloquea sola. Actas, contratos y oficios comparten plantillas y pueden parecerse mucho siendo distintos.
- Toda decisión del usuario queda en la auditoría.
- El SHA deja de ser UNIQUE global. Es único por documento, para permitir restaurar una versión anterior, y el aviso entre documentos se hace por consulta.
- [POR VERIFICAR] El umbral se calibra con PDF reales de la entidad (con autorización). Mientras tanto, con PDF ficticios, incluido un reescaneo simulado.
- [POR VERIFICAR] Librería de extracción (`pdfjs-dist` u otra) y rendimiento con PDF de 20 MB.
- Fuera de las primeras fases: validar conformidad PDF/A-1a (veraPDF).

## 6. Flujo de trabajo profesional

### 6.1 Monorepo [PROPUESTA]
Un solo repositorio (`faro-gestion-documental`), con npm workspaces, sin herramientas extra:

```
apps/api/        NestJS
apps/web/        React + Vite
packages/        tipos y contratos compartidos (cuando haga falta)
infra/           Dockerfiles, docker-compose, despliegue
docs/            ADR (docs/adr/), diagramas, matriz de roles, manual
legacy/prototipo-v1/   prototipo actual, movido con git mv (conserva historial) y con tag v0.1.0
.github/         plantillas de issue y PR, flujos de CI
```

### 6.2 Ramas, commits y PR
- `main` siempre desplegable y protegida: cambios solo por PR con CI en verde.
- Ramas cortas: `feat/<n>-descripcion`, `fix/<n>-...`, `chore/<n>-...`, donde `<n>` es el número del issue.
- Commits convencionales (`feat(api): ...`, `fix(web): ...`, `docs: ...`). Fecha real, sin retrodatar.
- Cada PR cierra un issue (`Closes #n`), usa la plantilla (qué, por qué, cómo probar, capturas) y se fusiona con squash.
- [POR VERIFICAR] Revisión: César no programa, así que revisa criterios de aceptación y documentación; el código lo valida el CI. No se simula una revisión de código que no ocurre.

### 6.3 Issues
Tipos, con plantilla en `.github/ISSUE_TEMPLATE/`: Historia de usuario, Tarea técnica, Bug, Decisión (ADR/spike).
- Etiquetas: `tipo:` (historia, tarea, bug, decisión, docs), `area:` (api, web, infra, datos, seguridad, docs, pruebas), `prioridad:` (must, should, could).
- Definición de listo: criterios de aceptación escritos, estimación en horas, responsable, hito.
- Definición de terminado: código fusionado en `main`, pruebas en verde, documentación actualizada, desplegado en el entorno de pruebas si aplica, entrada en la bitácora.

### 6.4 Tablero y hitos
- Se conserva el tablero #2 y sus campos (Responsable, Prioridad, Estimación, Paquete EDT, Iteración). Columnas: Backlog, Listo para el sprint, En progreso, En revisión, Hecho.
- Flujo: issue en Backlog, pasa a "Listo para el sprint" al cumplir la definición de listo, a "En progreso" al abrir la rama, a "En revisión" al abrir el PR y a "Hecho" al cerrar el issue. Los flujos automáticos del tablero se activan en la interfaz web (no por API).
- Hitos: la reconstrucción usa V2-M1 a V2-M4 (sección 7). Los hitos H1 a H6 del plan anterior se ignoran.
- Cada semana: planificación (elegir issues, un máximo igual a las horas disponibles), mitad de semana (revisión del tablero) y cierre (qué se movió a Hecho, bitácora).
- Versiones: tags `v0.1.0` (prototipo actual), `v2.0.0-alpha`, `v2.0.0`; `CHANGELOG.md`.

## 7. Hitos y capacidad

### 7.1 Hitos del plan anterior (ignorados desde el 11 de nov.; se conservan como referencia de fechas del curso) [CONFIRMADO]

| Hito | Fecha | Contenido |
|---|---|---|
| H3 | 16 nov | Cinco módulos completos y línea base |
| H4 | 23 nov | Pruebas con usuarios |
| H5 | 30 nov | Comparación con línea base, manual, video y póster |
| H6 | 7 dic | Informe final y socialización |

### 7.2 Hitos de la reconstrucción (nuevos) [PROPUESTA]

| Hito | Fecha | Entrega demostrable |
|---|---|---|
| V2-M1 Cimientos | 18 nov | Monorepo, Docker Compose, CI, ADR, API con `/health` y migración inicial |
| V2-M2 Núcleo | 25 nov | Auth, CCD, carga, versiones con restauración, verificación doble, búsqueda y auditoría, todo por API y probado |
| V2-M3 Nube y usuarios | 2 dic | Despliegue en Cloud Run + Neon + Cloud Storage, administración de usuarios, seguridad, copias de seguridad |
| V2-M4 Interfaz y cierre | 7 dic | Interfaz web, prueba e2e, `v2.0.0` |

### 7.3 Capacidad [CONFIRMADO, decisión del 11 de nov.]
El plan de trabajo original asignaba 6 h semanales por persona (Juan 27 h en total), insuficientes para esta reconstrucción. Decisión: **opción A, subir las horas de desarrollo** durante estas semanas. Alternativa descartada: recortar la interfaz (opción B). Si el avance real se desvía, se revisa en la planificación semanal y se registra en la bitácora. El plan de trabajo se actualiza con fecha real, sin retrodatar.

Las pruebas con usuarios (H4, 23 nov) se hacen sobre lo que esté desplegable ese día: v2 si V2-M2 está terminado, si no, el prototipo v0.1.0. Esa decisión se registra el 20 de noviembre.

## 8. Backlog propuesto (issues por crear) [PROPUESTA]

Prioridad: M = must, S = should, C = could. Horas: estimación inicial.

**V2-M1 Cimientos (18 nov)**

| # | Tipo | Título | Prio | Horas | Responsable |
|---|---|---|---|---|---|
| 1 | tarea | Estructurar el monorepo y mover el prototipo a `legacy/` con tag v0.1.0 | M | 2 | Juan |
| 2 | tarea | Docker Compose con Postgres y MinIO | M | 1 | Juan |
| 3 | tarea | CI en GitHub Actions: lint, pruebas y build | M | 1 | Juan |
| 4 | docs | Plantillas de issue y PR, CONTRIBUTING con flujo y commits | M | 2 | César |
| 5 | decisión | ADR-001 stack y ADR-002 arquitectura modular | M | 2 | César y Juan |
| 6 | historia | Esqueleto de la API: `/health`, configuración por entorno, migración inicial | M | 3 | Juan |
| 7 | tarea | Protección de `main` y etiquetas del repositorio | M | 0,5 | Juan |

**V2-M2 Núcleo (25 nov)**

| # | Tipo | Título | Prio | Horas | Responsable |
|---|---|---|---|---|---|
| 8 | historia | Ingreso y roles con argon2 y guardas por rol | M | 3 | Juan |
| 9 | historia | Cuadro de clasificación en Postgres con siembra ficticia | M | 2 | Juan |
| 10 | historia | Carga de documentos con la interfaz `AlmacenArchivos` (disco y MinIO) | M | 3 | Juan |
| 11 | historia | Versiones con historial y restauración de versión anterior | M | 3 | Juan |
| 12 | historia | Verificación doble: SHA-256 más similitud de texto con decisión del usuario | M | 5 | Juan |
| 13 | historia | Búsqueda por texto completo con paginación | S | 3 | Juan |
| 14 | historia | Auditoría de eventos, incluida la decisión ante un duplicado probable | M | 2 | Juan |
| 15 | tarea | Migrar las 7 pruebas actuales a la API y agregar pruebas de duplicados con un reescaneo simulado | M | 3 | Juan |
| 16 | tarea | Modelo de datos: diagrama ER y diccionario (1.3.1) | S | 2 | César |

**V2-M3 Nube y usuarios (2 dic)**

| # | Tipo | Título | Prio | Horas | Responsable |
|---|---|---|---|---|---|
| 17 | historia | Administración de usuarios por API: crear, desactivar, cambiar rol (HU-06) | M | 3 | Juan |
| 18 | tarea | Seguridad: CSRF, límite de intentos, cabeceras, secretos por entorno | M | 2 | Juan |
| 19 | historia | Carga del cuadro validado desde CSV (HU-07, 1.4.2) | S | 2 | Juan |
| 20 | tarea | Despliegue en Cloud Run + Neon + Cloud Storage, con alerta de presupuesto | M | 4 | Juan |
| 21 | tarea | Copia de seguridad con `pg_dump` y guía de restauración | S | 2 | Juan |
| 22 | docs | Matriz de roles y permisos (1.3.2) y diagrama de arquitectura (1.3.3) | S | 2 | César |

**V2-M4 Interfaz y cierre (7 dic)**

| # | Tipo | Título | Prio | Horas | Responsable |
|---|---|---|---|---|---|
| 23 | historia | Interfaz: ingreso, listado con búsqueda y paginación, detalle | S | 6 | Juan |
| 24 | historia | Interfaz: carga, nueva versión y pantalla de comparación de duplicado probable | S | 5 | Juan |
| 25 | historia | Interfaz: administración de usuarios y auditoría | C | 3 | Juan |
| 26 | tarea | Prueba e2e del flujo completo (Playwright) | C | 3 | Juan |
| 27 | tarea | CHANGELOG, release `v2.0.0` y actualización del manual (1.6.1) | S | 2 | Juan y César |

**Sin hito (backlog):** HU-08 (ver soportes de un expediente en un solo lugar para SECOP II y SIA Observa), validación PDF/A-1a, calibración del umbral con PDF reales.

Estado: los 27 issues se crearon el 11 de nov. con los mismos números que esta tabla (#1 a #27) y están en el tablero #2. Los hitos H1 a H6 y los 22 borradores anteriores del tablero se ignoran por decisión del usuario (se basaban en un plan más simple); no se borraron.

## 9. Decisiones

1. [CONFIRMADO] Capacidad: opción A, más horas de desarrollo (sección 7.3).
2. [CONFIRMADO] Se trabaja sobre el repositorio existente y se crean etiquetas, hitos V2 e issues (11 nov.). Los hitos y borradores anteriores se ignoran.
3. [CONFIRMADO] El prototipo se mueve a `legacy/prototipo-v1/` con tag `v0.1.0` sobre el commit `a96ec15` (issue #1).
4. [CONFIRMADO] Hay tarjeta disponible para GCP. [POR VERIFICAR] cuotas gratuitas vigentes el día del despliegue.
5. [CONFIRMADO] `iniciar-demo.bat` no entra al repositorio; está en `.gitignore`.
6. [PENDIENTE] Rol de César en el nuevo flujo (propuesta: documentación, criterios de aceptación, pruebas con usuarios). Los issues ya lo usan como responsable de #4, #16 y #22.
7. [PENDIENTE] Qué hacer con los hitos H1 a H6 y los borradores anteriores (dejarlos, archivarlos o borrarlos). No se tocan sin que lo indiques.

## 10. Fuentes

- [Neon: límites del plan gratuito](https://neon.com/faqs/free-plan-limits-and-quotas)
- [Google Cloud Free Tier](https://cloud.google.com/free) y [Cloud Run](https://cloud.google.com/run) (cifras exactas por confirmar; las guías de terceros difieren)
- [Azure: cuenta gratuita](https://azure.microsoft.com/free/)
