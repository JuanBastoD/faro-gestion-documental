# Registro de cambios

Todos los cambios notables de este proyecto se documentan en este archivo. El formato sigue [Keep a Changelog 1.1.0](https://keepachangelog.com/es-ES/1.1.0/) y el versionado, [SemVer](https://semver.org/lang/es/).

> **BORRADOR para el issue #27.** Este archivo describe la versión `v2.0.0`, que **todavía no se publica**: no existe el tag ni el release (los publica el usuario, ver [`docs/notas-de-version-v2.0.0.md`](docs/notas-de-version-v2.0.0.md)) y los `package.json` siguen en `0.0.0`. Redactado a partir de `git log --first-parent origin/main` (en `main` hasta el PR #49, commit `4a4a1d1`), de `docs/PLAN_EJECUCION.md` (sección 9), de los ADR 0001 a 0013 y de los PR abiertos al 23 de noviembre de 2026.

Cómo leerlo:

- Cada ítem cita su **issue** (`#n` de un issue) y su **PR** (`PR #n`). Un PR sin issue lo dice.
- **(en revisión, PR #n)** marca lo que ya es contenido de la versión pero **aún no está fusionado en `main`**: el PR está abierto y la ficha dice «en revisión». Lo que no lleva la marca ya está en `main`.
- Etiquetas de certeza: [CONFIRMADO] comprobado en el repositorio o en GitHub; [PROPUESTA] decidido, sin construir o sin aceptar por el usuario; [POR VERIFICAR] depende de una prueba o de un dato que falta; [SUPUESTO] razonable pero sin medir; [DESCARTADO] se consideró y no se hizo.
- Todos los datos del sistema son **ficticios** (usuarios `*.demo`, PDF generados, cuadro de ejemplo inventado). Nada de la entidad.

## [2.0.0] — sin publicar

Reconstrucción completa del prototipo: de un primer incremento con Express y SQLite (`v0.1.0`, hoy en `legacy/prototipo-v1/`) a una API con PostgreSQL, almacén de archivos S3, auditoría, roles, versiones, verificación doble de duplicados, búsqueda de texto completo y una interfaz web. Hitos: V2-M1 Cimientos, V2-M2 Núcleo, V2-M3 Nube y usuarios, V2-M4 Interfaz y cierre.

### Agregado

**V2-M1 Cimientos**

- Monorepo con npm workspaces (`apps/api`, `apps/web`, `infra/`, `docs/`) y el prototipo v1 movido a `legacy/prototipo-v1/`, que sigue funcionando por separado. Issue #1, PR #28.
- Docker Compose con PostgreSQL 17 y un almacén de archivos S3 (RustFS; MinIO se descartó porque sus imágenes oficiales ya no se publican, ADR-0001). Issue #2, PR #29.
- Esqueleto de la API NestJS: `GET /health` (200 con base, 503 sin ella), configuración por variables de entorno validada con zod y migración inicial `0000`. Issue #6, PR #30.
- Integración continua en GitHub Actions: lint, pruebas y build. Issue #3, PR #31.
- Protección de la rama `main`: exige que pasen `api`, `legacy` e `infra` antes de fusionar. Issue #7 (ajuste del repositorio, sin PR).

**V2-M2 Núcleo**

- Ingreso con **argon2id**, sesiones guardadas en PostgreSQL (cookie `faro_sesion`, vence a las 8 horas sin uso y a los 7 días en todo caso), tres roles (administrador, editor y consulta), guardas globales (todo exige sesión salvo `/health` y el ingreso), siembra de tres usuarios ficticios y base de datos de pruebas aparte. ADR-0003, migración `0001`. Issue #8, PR #37.
- **Auditoría inmutable:** `GET /auditoria` solo para el administrador, con filtros por usuario, acción, documento y fechas, y un disparador que impide `UPDATE` y `DELETE` sobre los eventos. Migración `0002`. Issue #14, PR #38.
- **Cuadro de clasificación documental** provisional (series y subseries) con siembra ficticia e idempotente; `GET /series`; solo las subseries admiten documentos, regla impuesta por el servicio y por la base. Migración `0003`. Issue #9, PR #39.
- **Carga de documentos:** `POST /documentos` (solo PDF por su contenido, máximo 20 MB), descarga por versión, almacén tras el puerto `AlmacenArchivos` (disco y S3) y carga sin estados a medias (si falla algo no queda ni registro ni archivo). Comando `npm run almacen:huerfanos` para listar y borrar archivos sin versión. ADR-0004. Issue #10, PR #40.
- **Versiones y restauración:** historial con autor, fecha y motivo; subir una versión nueva exige motivo; restaurar crea una versión nueva sin editar ni borrar nada; la numeración no se pisa con peticiones simultáneas. ADR-0005, migración `0004`. Issue #11, PR #41.
- **Verificación doble de duplicados:** huella SHA-256 (idéntico: 409 `duplicado_exacto`) y similitud de texto con firma MinHash (muy parecido: 409 `duplicado_probable`; la persona decide `nueva_version` o `documento_distinto` y la decisión queda en la auditoría). Umbral por defecto 0,80. ADR-0006, migración `0005`. Issue #12, PR #42.
- **Búsqueda por texto completo:** `GET /documentos?q=&serieId=&pagina=&tamano=` sin distinguir tildes ni mayúsculas, por relevancia y con paginación estable (máximo 50 por página). ADR-0007, migración `0006`. Issue #13, PR #43.
- Pruebas de aceptación: las 7 del prototipo v1 repetidas contra la API nueva (incluida la persistencia tras reiniciar la aplicación) y 41 unitarias de versiones y duplicados. Issue #15, PR #44.
- `docs/modelo-de-datos.md`: diagrama entidad-relación y diccionario por tabla y campo; una prueba lo compara con la base migrada y el CI falla si queda desactualizado. Issue #16, PR #45.

**V2-M3 Nube y usuarios**

- **Administración de usuarios por API:** `GET /usuarios`, `POST /usuarios` y `PATCH /usuarios/:id` (rol y activo). Nunca se borra a nadie; desactivar cierra sus sesiones; el último administrador activo no puede dejar de serlo (409 `ultimo_administrador`). ADR-0008. Issue #17, PR #46.
- **Seguridad mínima para exponer la API:** límite de 5 intentos de ingreso por usuario y 30 por IP en 15 minutos (429 con `Retry-After`), guarda de origen contra CSRF (403 `origen_no_permitido`), cabeceras con `helmet` y trabajo de CI `secretos` con gitleaks. ADR-0009, migración `0007`. Issue #18, PR #49.
- **Despliegue, parte autónoma:** `Dockerfile` de la API en varias etapas, flujo manual `deploy.yml` hacia Google Cloud Run (inactivo hasta que existan sus variables), comandos `migrar-cli` y `crear-administrador` para la imagen y `docs/despliegue.md` con el guion paso a paso. Issue #20 (`Refs`, queda abierto: las cuentas y el despliegue real son del usuario), PR #47.
- `docs/matriz-de-roles.md` (quién puede hacer qué, endpoint por endpoint, comprobada por una prueba contra la API real) y `docs/arquitectura.md` (diagrama de componentes y cinco diferencias entre el código y el ADR-0002). Issue #22, PR #48.
- **Importación del cuadro de clasificación desde CSV por línea de comandos** (`npm run ccd:importar`): simulación por defecto, todo o nada, sin tocar lo que ya tiene documentos; CSV ficticio de ejemplo en `docs/ejemplos/cuadro-ejemplo.csv`. ADR-0010. Issue #19 *(en revisión, PR #55)*.
- **Cambio y restablecimiento de clave:** `POST /auth/clave` (clave actual obligatoria) y `POST /usuarios/:id/clave` (clave temporal del administrador, con acceso restringido hasta cambiarla). ADR-0011, migración `0008`. Issue #51 *(en revisión, PR #57, apilado sobre el PR #55)*.
- **Copia de seguridad:** `pg_dump` en un script verificado, restauración solo a una base nueva, flujo programado `respaldo.yml` hacia un bucket privado (inactivo hasta que existan sus variables) y `docs/respaldo.md`. ADR-0013. Issue #21 *(en revisión, PR #53; `Refs`, la activación es del usuario)*.

**V2-M4 Interfaz y cierre**

- **Interfaz web** (React 19, Vite y TypeScript, CSS propio) servida por la propia API bajo `/app/`: ingreso y cierre de sesión, listado con búsqueda, filtro por serie y paginación (el estado queda en la dirección), detalle con historial de versiones y descarga, menú según el rol y uso desde 360 px de ancho. ADR-0012. Issue #23 *(en revisión, PR #54)*.
- **Interfaz de carga:** formulario de carga de un documento, formulario de versión nueva, restaurar una versión anterior y pantalla que compara el documento que ya existe con el archivo que se intenta cargar cuando se avisa de un duplicado probable. Issue #24 *(en revisión, PR #58, listo para revisar y apilado sobre el PR #54: no puede fusionarse antes que él; ADR-0012, sección 6)*.
- Este registro de cambios, las notas de la versión y el borrador del manual de usuario. Issue #27 *(en revisión, PR #61, `Refs`; el tag y el release los publica el usuario)*.

### Cambiado

**V2-M1 Cimientos**

- El CI ya no cancela las ejecuciones que están en curso sobre `main` cuando se fusionan PR seguidos (`cancel-in-progress` solo fuera de `main`). Sin issue, PR #36.

**V2-M2 Núcleo**

- La similitud de duplicados usa una **firma MinHash propia en lugar de `pg_trgm`**: se midió y no sirve (consulta de 14,4 s en p50 y 15,8 s en p95 con 100 documentos de unas 100 páginas, y no distingue documentos largos). Reemplaza lo previsto en `docs/PLAN_MEJORA.md`. ADR-0006, PR #42.
- La búsqueda **normaliza el texto en la aplicación y usa la configuración `spanish`**, sin la extensión `unaccent` ni una configuración propia, como proponía el plan. ADR-0007, PR #43.

**V2-M3 Nube y usuarios**

- La protección CSRF es una **verificación de origen en lugar del token de doble envío** que pedía `docs/PLAN_EJECUCION.md`, y el límite de intentos usa solo la base de datos, sin `@nestjs/throttler`. [POR VERIFICAR] con quien revise el ADR-0009. PR #49.
- El trabajo `secretos` del CI escanea solo el historial alcanzable desde `HEAD` y no el de todas las ramas, para que un hallazgo en la rama de un PR no marque en rojo a los demás. Sin issue *(en revisión, PR #60)*.
- El CI revisa los tipos con `tsc --noEmit` sobre `src/` y `test/` (Oxlint y Vitest no los revisan). Issue #52 *(en revisión, PR #56)*.

### Corregido

- **Defecto de diseño del esquema inicial:** la restricción `UNIQUE (documento_id, sha256)` impedía restaurar una versión anterior. Se reemplazó por un índice único parcial (`WHERE restaurada_de IS NULL`): subir de nuevo un archivo idéntico a una versión del mismo documento sigue siendo imposible; restaurar sí. Migración `0004`, ADR-0005. Issue #11, PR #41.
- **Bloqueo mutuo (`deadlock`, error 500) intermitente** en `PATCH /usuarios/:id` cuando varios administradores cambian roles a la vez (falló una vez en el CI): los cambios que pueden quitar administradores se ponen en fila con un candado consultivo y se repite la transacción hasta 3 veces ante ese error. Sin issue *(en revisión, PR #59, listo para revisar; [PROPUESTA] hasta que el usuario decida)*.

### Seguridad

- Claves con argon2id; verificación de una clave aunque el usuario no exista y mensaje único para usuario inexistente, inactivo o clave errónea. ADR-0003, PR #37.
- Sesiones en el servidor: del token solo se guarda su SHA-256; desactivar a una persona invalida sus sesiones al instante; cada ruta nueva nace protegida (`@Publico()` es la excepción, no la regla). ADR-0003, PR #37.
- Cada acción denegada (403) y cada descarga queda en la auditoría; los eventos no se editan ni se borran, ni por la API ni por SQL. PR #37, PR #38, PR #40.
- Límite de intentos de ingreso que no delata qué usuarios existen y no cuesta una verificación argon2 una vez bloqueado; guarda de origen en toda petición que modifica datos; `helmet`; gitleaks sobre el historial en cada PR. ADR-0009, PR #49.
- La interfaz no guarda tokens en `localStorage` y es compatible con la política de contenido de `helmet` (una prueba comprueba que `index.html` no tiene código ni estilos en línea ni orígenes externos). ADR-0012 *(en revisión, PR #54)*.
- Cambio de clave que exige la clave actual y cierra las demás sesiones; la clave temporal limita al usuario a ver quién es, cerrar sesión y cambiarla; los fallos cuentan en el mismo límite de intentos; nunca se guardan claves ni hashes en la auditoría. ADR-0011 *(en revisión, PR #57)*.
- Copias de seguridad que **nunca** viajan como artefacto de GitHub Actions (en un repositorio público cualquiera podría descargarlos): van a un bucket privado, con una cuenta que solo puede crear objetos. ADR-0013 *(en revisión, PR #53)*.

### Documentación

- Plantillas de issue y de PR, y `CONTRIBUTING.md` con el flujo y los commits convencionales. Issue #4, PR #33.
- ADR-0001 (stack) y ADR-0002 (arquitectura modular con puertos y adaptadores). Issue #5, PR #34.
- Reajuste de las fechas de V2-M1 y V2-M2 y registro de las decisiones del 22 de noviembre. Sin issue, PR #32.
- `docs/PLAN_EJECUCION.md`: orden, protocolo de ejecución sin supervisión y estado de lo hecho. Sin issue, PR #35.
- ADR-0003 a ADR-0009 en los PR de cada función (ver arriba), `docs/modelo-de-datos.md` (#16), `docs/matriz-de-roles.md` y `docs/arquitectura.md` (#22), `docs/despliegue.md` (#20).
- Pendientes de fusionar *(en revisión)*: ADR-0010 (PR #55), ADR-0011 (PR #57), ADR-0012 (PR #54) y ADR-0013 junto con `docs/respaldo.md` (PR #53).

### Lo que NO incluye v2.0.0

Todo esto queda **fuera**, a propósito o por falta de tiempo. No se debe presentar como parte del sistema.

- **Fuera del alcance del proyecto de clase** (`docs/PLAN_EJECUCION.md`, sección 4.2): elaboración de las TRD y TVD definitivas, digitalización retroactiva del archivo histórico, servidor, red, UPS, rack y cualquier infraestructura de TI de la entidad. El cuadro de clasificación es **provisional** y lo debe validar la entidad (ADR-0010).
- **Datos reales:** el sistema solo se probó con datos ficticios. Usar PDF reales requiere autorización escrita de la entidad (plan, sección 6, punto 6). Por eso el **umbral de similitud 0,80 es provisional** [POR VERIFICAR contra PDF reales] y la calibración de MinHash es [CONFIRMADO en simulación, SUPUESTO sobre PDF reales] (ADR-0006).
- **Permisos por documento, por serie o por área:** todo usuario con sesión ve todos los documentos (`docs/matriz-de-roles.md`, sección 4). Si algún documento debe ser reservado, falta un modelo de permisos.
- **Recuperación de clave sin administrador:** no hay «olvidé mi clave» por correo ni preguntas secretas (ADR-0011, alternativas descartadas). El **único administrador que olvida su clave no tiene salida por la API** (ADR-0011, sección 4, [POR VERIFICAR] un comando de emergencia con acceso a la base).
- **Pantalla de cambio de clave** en la interfaz: el cambio existe solo por la API (ADR-0011) y la interfaz de #23 y #24 no la trae [POR VERIFICAR].
- **Pantallas de administración de usuarios y de auditoría** en la interfaz (issue #25, prioridad *could*): hoy esas rutas muestran un marcador; se usan por API [POR VERIFICAR el estado de #25 al publicar].
- **Prueba e2e con Playwright** que corra en el CI (issue #26, prioridad *could*): [POR VERIFICAR] si se hace. La interfaz se comprobó a mano con Chromium (ADR-0012), no con una prueba automática en el CI.
- **Despliegue real en la nube** (Cloud Run, Neon, Cloud Storage): el guion y los flujos existen, pero las cuentas, la alerta de presupuesto y la federación son del usuario (issue #20, abierto). [POR VERIFICAR] cuotas gratuitas el día de desplegar y que la API funcione con la versión de PostgreSQL de Neon (ADR-0013).
- **Respaldo de los PDF** (solo se respalda la base) y limpieza programada de archivos huérfanos (ADR-0013).
- **Importar el cuadro desde la interfaz:** es un comando que ejecuta quien despliega, no un endpoint (ADR-0010).
- **Borrar o editar documentos y versiones:** el historial solo crece por diseño (ADR-0004 y ADR-0005). Tampoco se edita el nombre de un usuario, ni se borra a nadie (ADR-0008).
- **OCR propio:** se lee la capa de texto que ya traiga el PDF; los PDF sin texto (o con menos de 50 palabras) solo se verifican por huella exacta (ADR-0006).
- **Segundo factor de autenticación** y cualquier defensa de infraestructura (cortafuegos, WAF) (ADR-0009).
- **Integración con SIA o SECOP:** no existe; solo se menciona como posibilidad futura al elegir una API REST (ADR-0001).
- **Navegadores:** solo se probó Chromium; Firefox y Safari son [POR VERIFICAR] (ADR-0012). Tampoco se hizo una revisión con lector de pantalla ni con personas usuarias reales.
- **Cifras de rendimiento medidas con uso real:** no hay. Las únicas mediciones son las de los ADR (ADR-0006 y ADR-0007), con datos ficticios.

### Verificado / por verificar

**[CONFIRMADO]** (con la fuente que lo respalda):

- `main` está en `4a4a1d1` y el CI de las últimas ejecuciones sobre `main` terminó en verde (`gh run list --branch main`, 23 de noviembre de 2026).
- Los PR #53, #54, #55, #56, #57 y #60 tenían los cinco o seis trabajos del CI en verde (`gh pr view`, 23 de noviembre de 2026). Los PR #58 y #59 ya están listos para revisar y tienen en verde `api`, `legacy`, `infra` e `imagen`; su trabajo `secretos` salió en rojo porque ese trabajo escanea el historial de todas las ramas y arrastra dos falsos positivos de otra rama (56 commits revisados, 2 hallazgos), defecto que corrige el PR #60. Hasta que se fusione el #60 y se vuelvan a ejecutar, no se da por bueno su `secretos` [POR VERIFICAR].
- Las 7 pruebas de aceptación de v1 pasan contra la API nueva (PR #44) y la matriz de roles y el modelo de datos se comprueban contra la API y la base en cada ejecución del CI (PR #45 y PR #48).
- La interfaz del PR #54 se comprobó con Chromium 159 (Playwright 1.65.1, fuera del repositorio) a 1280 y 360 px: 60 de 60 comprobaciones, sin errores en la consola ni violaciones de la política de contenido; axe-core (WCAG 2.1 A y AA) no halló violaciones (ADR-0012, sección 2.5).
- El restablecimiento de clave tiene 68 casos de integración (ADR-0011, sección 5).

**[POR VERIFICAR]**

- Que las migraciones `0000` a `0008` se apliquen en el orden correcto sobre una base real de **Neon** con la versión de PostgreSQL que le toque, y la disponibilidad de las extensiones usadas (ADR-0007, ADR-0013).
- Que la verificación de origen (CSRF) funcione con navegadores reales **servida por la API en la nube** (ADR-0009, ADR-0012). Se comprobó con Chromium en local.
- Quién redacta la versión final del manual de usuario (ver `docs/manual-de-usuario.md`).
- Que `CONFIAR_EN_PROXY=1` sea el valor correcto en Cloud Run al primer despliegue (ADR-0009).
- La **línea base real de solicitudes de re-escaneo**: las cifras de ese problema siguen [SIMULADO] y no se presentan como hechos hasta medirlas.

**[SUPUESTO]**

- Las estimaciones de horas del plan no se midieron (`docs/PLAN_EJECUCION.md`, sección 2).
- Los límites de intentos de ingreso (5 por usuario y 30 por IP en 15 minutos) y el largo mínimo de 12 caracteres de las claves no son una política de la entidad (ADR-0009 y ADR-0008).

## [0.1.0] — 2026-11-08

Primer incremento del prototipo, con Express y SQLite. Hoy está congelado en `legacy/prototipo-v1/` y se publicó como el tag `v0.1.0`; sirvió de base para las 7 pruebas de aceptación que la versión 2.0.0 repite contra la API nueva.

[2.0.0]: https://github.com/JuanBastoD/faro-gestion-documental/compare/v0.1.0...main
[0.1.0]: https://github.com/JuanBastoD/faro-gestion-documental/tree/v0.1.0
