# Registro de cambios

Todos los cambios notables de este proyecto se documentan en este archivo. El formato sigue [Keep a Changelog 1.1.0](https://keepachangelog.com/es-ES/1.1.0/) y el versionado, [SemVer](https://semver.org/lang/es/).

> **BORRADOR para el issue #27.** Este archivo describe la versión `v2.0.0`, que **todavía no se publica**: no existe el tag ni el release (los publica el usuario, ver [`docs/notas-de-version-v2.0.0.md`](docs/notas-de-version-v2.0.0.md)) y los `package.json` siguen en `0.0.0`. Redactado a partir de `git log --first-parent origin/main` (al 25 de noviembre de 2026, `main` está en el commit `4cd67ad`, la fusión del PR #65), de `docs/PLAN_EJECUCION.md` (sección 9), de los ADR 0001 a 0013 y de los PR #53 a #66, que se fusionaron en `main` el 25 de noviembre de 2026.

Cómo leerlo:

- Cada ítem cita su **issue** (`#n` de un issue) y su **PR** (`PR #n`). Un PR sin issue lo dice.
- **(PR #n, fusionado)** marca lo que se fusionó en `main` el 25 de noviembre de 2026 (los PR #53 a #66, después de la primera redacción de este archivo; el último, el #65, es el commit `4cd67ad`). Lo que no lleva esa marca ya estaba en `main` desde antes. **(en revisión, PR #61)** es este mismo archivo: el único PR de esta versión que aún no se fusiona.
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
- **Importación del cuadro de clasificación desde CSV por línea de comandos** (`npm run ccd:importar`): simulación por defecto, todo o nada, sin tocar lo que ya tiene documentos; CSV ficticio de ejemplo en `docs/ejemplos/cuadro-ejemplo.csv`. ADR-0010. Issue #19 *(PR #55, fusionado)*.
- **Cambio y restablecimiento de clave:** `POST /auth/clave` (clave actual obligatoria) y `POST /usuarios/:id/clave` (clave temporal del administrador, con acceso restringido hasta cambiarla). ADR-0011, migración `0008`. Issue #51 *(PR #57, fusionado; las pantallas llegaron con el PR #66, ver V2-M4)*.
- **Copia de seguridad:** `pg_dump` en un script verificado, restauración solo a una base nueva, flujo programado `respaldo.yml` hacia un bucket privado (inactivo hasta que existan sus variables) y `docs/respaldo.md`. ADR-0013. Issue #21 *(PR #53, fusionado; `Refs`, el issue sigue abierto porque la activación es del usuario)*.

**V2-M4 Interfaz y cierre**

- **Interfaz web** (React 19, Vite y TypeScript, CSS propio) servida por la propia API bajo `/app/`: ingreso y cierre de sesión, listado con búsqueda, filtro por serie y paginación (el estado queda en la dirección), detalle con historial de versiones y descarga, menú según el rol y uso desde 360 px de ancho. ADR-0012. Issue #23 *(PR #54, fusionado)*.
- **Interfaz de carga:** formulario de carga de un documento, formulario de versión nueva, restaurar una versión anterior y pantalla que compara el documento que ya existe con el archivo que se intenta cargar cuando se avisa de un duplicado probable. Issue #24 *(PR #58, fusionado, con un arreglo de diseño posterior (commit `cac8cfe`: las opciones de la lista de candidatos se montaban unas sobre otras); ADR-0012, sección 6)*.
- **Interfaz de administración de usuarios y de auditoría** (solo administrador): lista de usuarios; crear un usuario con una clave inicial que escribe el administrador [PROPUESTA] y el rol Consulta marcado por omisión [PROPUESTA]; cambiar el rol, desactivar y reactivar, cada cambio con un panel que explica qué pasará (avisa si es la propia cuenta y explica el rechazo del último administrador activo); y una pantalla de auditoría de solo lectura con filtros por usuario, acción, documento y fechas (cada fecha es un día entero de la hora de Colombia [PROPUESTA]) y 20 eventos por página. El filtro de acciones ofrece las 14 que ya tenía el catálogo; **todavía faltan** `ccd_importado`, `clave_cambiada` y `clave_restablecida`, que ya están en `main` pero la pantalla aún no las ofrece [PENDIENTE: agregarlas]. Incluye el arreglo del aviso «Tu sesión terminó», que se partía dentro de la tarjeta de ingreso (commit `87ba312`) y, en la punta `8acb53f`, dos arreglos más: el aviso «ya tiene el rol …» desaparece al elegir otro rol, y el detalle de un «Acceso denegado» en la auditoría dice «Intentó hacer algo que su rol no permite; no se le concedió el acceso.» en lugar del texto técnico (la API sigue guardando el texto completo) [CONFIRMADO: capturas 39 y 43 del manual, rehechas con esa punta]. Issue #25 *(PR #62, fusionado; ADR-0012, sección 7)*.
- **Pantallas de cambio y de restablecimiento de clave:** el enlace «Mi clave» del menú para cualquier rol; quien entra con una clave temporal llega a «Cambiar mi clave» **sin menú** y no puede abrir nada más hasta elegir una propia; el administrador restablece la clave de otra persona escribiendo una temporal o generándola (16 letras y cifras en grupos de cuatro [PROPUESTA]) y la ve **una sola vez**. Usa la API del PR #57. Issue #51 *(PR #66, fusionado; ADR-0012, sección 8)*. Se probó de punta a punta, antes de fusionar, en una rama local descartable que juntaba #66 y #57 (capturas 45 a 51 del manual) [CONFIRMADO].
- **Prueba e2e con Playwright** del flujo de la demostración (ingreso, carga, duplicado probable, versión nueva y auditoría; 12 pasos) y un trabajo `web-e2e` en el CI, **no obligatorio**. Añade `@playwright/test` como dependencia de desarrollo de `apps/web`. Issue #26 *(PR #65, fusionado; ADR-0012, sección 9)*.
- Este registro de cambios, las notas de la versión y el borrador del manual de usuario. Issue #27 *(en revisión, PR #61, `Refs`; el tag y el release los publica el usuario)*.

### Cambiado

**V2-M1 Cimientos**

- El CI ya no cancela las ejecuciones que están en curso sobre `main` cuando se fusionan PR seguidos (`cancel-in-progress` solo fuera de `main`). Sin issue, PR #36.

**V2-M2 Núcleo**

- La similitud de duplicados usa una **firma MinHash propia en lugar de `pg_trgm`**: se midió y no sirve (consulta de 14,4 s en p50 y 15,8 s en p95 con 100 documentos de unas 100 páginas, y no distingue documentos largos). Reemplaza lo previsto en `docs/PLAN_MEJORA.md`. ADR-0006, PR #42.
- La búsqueda **normaliza el texto en la aplicación y usa la configuración `spanish`**, sin la extensión `unaccent` ni una configuración propia, como proponía el plan. ADR-0007, PR #43.

**V2-M3 Nube y usuarios**

- La protección CSRF es una **verificación de origen en lugar del token de doble envío** que pedía `docs/PLAN_EJECUCION.md`, y el límite de intentos usa solo la base de datos, sin `@nestjs/throttler`. [POR VERIFICAR] con quien revise el ADR-0009. PR #49.
- El trabajo `secretos` del CI escanea solo el historial alcanzable desde `HEAD` y no el de todas las ramas, para que un hallazgo en la rama de un PR no marque en rojo a los demás. Sin issue *(PR #60, fusionado)*.
- El CI revisa los tipos con `tsc --noEmit` sobre `src/` y `test/` (Oxlint y Vitest no los revisan). Issue #52 *(PR #56, fusionado)*.
- El CI suma el trabajo `respaldo` (prueba el script de copia de seguridad contra una base real; PR #53) y el trabajo `web-e2e` (la prueba de navegador, no obligatorio; PR #65). En `main`, la ejecución de `4cd67ad` pasó los siete trabajos (`api`, `legacy`, `infra`, `imagen`, `secretos`, `respaldo` y `web-e2e`) [CONFIRMADO: `gh run view 45638995417`, 25 de noviembre de 2026].

### Corregido

- **Defecto de diseño del esquema inicial:** la restricción `UNIQUE (documento_id, sha256)` impedía restaurar una versión anterior. Se reemplazó por un índice único parcial (`WHERE restaurada_de IS NULL`): subir de nuevo un archivo idéntico a una versión del mismo documento sigue siendo imposible; restaurar sí. Migración `0004`, ADR-0005. Issue #11, PR #41.
- **Bloqueo mutuo (`deadlock`, error 500) intermitente** en `PATCH /usuarios/:id` cuando varios administradores cambian roles a la vez (falló una vez en el CI): los cambios que pueden quitar administradores se ponen en fila con un candado consultivo y se repite la transacción hasta 3 veces ante ese error. Sin issue *(PR #59, fusionado)*.
- **Al fusionar #59 y #57 juntos en `main` falló `tsc --noEmit`** (error TS2741: falta `debeCambiarClave` en `test/usuarios-concurrencia.e2e-spec.ts`): cada PR pasaba por separado. Lo detectó el paso `tsc --noEmit` que añadió el PR #56 (ejecución 45634742194, sobre `9c89b15`, la fusión del #57) y se corrigió con un commit dentro del PR #54 (`a51b3eb`, solo la prueba, sin cambios de comportamiento) [CONFIRMADO].

### Seguridad

- Claves con argon2id; verificación de una clave aunque el usuario no exista y mensaje único para usuario inexistente, inactivo o clave errónea. ADR-0003, PR #37.
- Sesiones en el servidor: del token solo se guarda su SHA-256; desactivar a una persona invalida sus sesiones al instante; cada ruta nueva nace protegida (`@Publico()` es la excepción, no la regla). ADR-0003, PR #37.
- Cada acción denegada (403) y cada descarga queda en la auditoría; los eventos no se editan ni se borran, ni por la API ni por SQL. PR #37, PR #38, PR #40.
- Límite de intentos de ingreso que no delata qué usuarios existen y no cuesta una verificación argon2 una vez bloqueado; guarda de origen en toda petición que modifica datos; `helmet`; gitleaks sobre el historial en cada PR. ADR-0009, PR #49.
- La interfaz no guarda tokens en `localStorage` y es compatible con la política de contenido de `helmet` (una prueba comprueba que `index.html` no tiene código ni estilos en línea ni orígenes externos). ADR-0012 *(PR #54, fusionado)*.
- Cambio de clave que exige la clave actual y cierra las demás sesiones; la clave temporal limita al usuario a ver quién es, cerrar sesión y cambiarla; los fallos cuentan en el mismo límite de intentos; nunca se guardan claves ni hashes en la auditoría. ADR-0011 *(PR #57, fusionado)*.
- El registro del servidor ya no lleva los valores de una consulta que falla (en `usuarios` eran hashes de clave): se escribe la clase del error, la primera línea del mensaje, los códigos y la pila, sin parámetros. La respuesta al cliente no cambia (500 genérico). Hallazgo H-02 de la revisión de seguridad del trabajo nocturno, gravedad baja, sin issue *(PR #63, fusionado)*.
- Las respuestas de la API llevan `Cache-Control: no-store` (JSON, PDF y errores), salvo la interfaz web bajo `/app`, para que un computador compartido no conserve listados, documentos ni PDF en la caché del navegador. Hallazgo H-07 de esa misma revisión, gravedad baja, sin issue *(PR #64, fusionado)*.
- Copias de seguridad que **nunca** viajan como artefacto de GitHub Actions (en un repositorio público cualquiera podría descargarlos): van a un bucket privado, con una cuenta que solo puede crear objetos. ADR-0013 *(PR #53, fusionado)*.

### Documentación

- Plantillas de issue y de PR, y `CONTRIBUTING.md` con el flujo y los commits convencionales. Issue #4, PR #33.
- ADR-0001 (stack) y ADR-0002 (arquitectura modular con puertos y adaptadores). Issue #5, PR #34.
- Reajuste de las fechas de V2-M1 y V2-M2 y registro de las decisiones del 22 de noviembre. Sin issue, PR #32.
- `docs/PLAN_EJECUCION.md`: orden, protocolo de ejecución sin supervisión y estado de lo hecho. Sin issue, PR #35.
- ADR-0003 a ADR-0009 en los PR de cada función (ver arriba), `docs/modelo-de-datos.md` (#16), `docs/matriz-de-roles.md` y `docs/arquitectura.md` (#22), `docs/despliegue.md` (#20).
- ADR-0010 (PR #55), ADR-0011 (PR #57), ADR-0012 (PR #54; su sección 6 llegó con el PR #58 y la 7 con el PR #62; la **8 es la de las pantallas de clave, del PR #66, y la 9 es la de la prueba e2e (#26), del PR #65**) y ADR-0013 junto con `docs/respaldo.md` (PR #53), todos fusionados el 25 de noviembre de 2026 [CONFIRMADO].

### Lo que NO incluye v2.0.0

Todo esto queda **fuera**, a propósito o por falta de tiempo. No se debe presentar como parte del sistema.

- **Fuera del alcance del proyecto de clase** (`docs/PLAN_EJECUCION.md`, sección 4.2): elaboración de las TRD y TVD definitivas, digitalización retroactiva del archivo histórico, servidor, red, UPS, rack y cualquier infraestructura de TI de la entidad. El cuadro de clasificación es **provisional** y lo debe validar la entidad (ADR-0010).
- **Datos reales:** el sistema solo se probó con datos ficticios. Usar PDF reales requiere autorización escrita de la entidad (plan, sección 6, punto 6). Por eso el **umbral de similitud 0,80 es provisional** [POR VERIFICAR contra PDF reales] y la calibración de MinHash es [CONFIRMADO en simulación, SUPUESTO sobre PDF reales] (ADR-0006).
- **Permisos por documento, por serie o por área:** todo usuario con sesión ve todos los documentos (`docs/matriz-de-roles.md`, sección 4). Si algún documento debe ser reservado, falta un modelo de permisos.
- **Recuperación de clave sin administrador:** no hay «olvidé mi clave» por correo ni preguntas secretas (ADR-0011, alternativas descartadas). El **único administrador que olvida su clave no tiene salida por la API** (ADR-0011, sección 4, [POR VERIFICAR] un comando de emergencia con acceso a la base).
- **Filtro de acciones de la auditoría incompleto:** la pantalla Auditoría aún no ofrece en su filtro `ccd_importado`, `clave_cambiada` ni `clave_restablecida` (los eventos sí salen en la lista con su nombre) [PENDIENTE: agregarlas, ahora que #19 y #51 están en `main`]. Además, el «Acceso denegado» que produce una clave temporal se ve con el texto técnico («GET /documentos; cambio de clave requerido») y no con el texto en palabras de los accesos denegados por rol [CONFIRMADO en la captura 43 del manual; decisión pendiente].
- **La prueba e2e no frena las fusiones:** el trabajo `web-e2e` corre en cada PR y en `main`, pero no es obligatorio [CONFIRMADO: PR #65]. Solo cubre el flujo de la demostración, con Chromium.
- **Hallazgos de la revisión de seguridad interna sin tratar:** H-03, H-06, H-10 e I-09 no se corrigen en esta versión (solo H-02 y H-07, PR #63 y #64) [PENDIENTE: decidir si entran antes de publicar].
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

- `main` está en `4cd67ad` (25 de noviembre de 2026), la fusión del PR #65. El CI sobre `main` pasó en verde, con los siete trabajos (`api`, `legacy`, `infra`, `imagen`, `secretos`, `respaldo` y `web-e2e`), en la ejecución de `4cd67ad` (45638995417) y en las de las fusiones de #60, #56, #53, #55, #64, #54, #58, #62 y #66; la de la fusión del PR #57 (`9c89b15`, ejecución 45634742194) falló en `tsc --noEmit` y se corrigió (ver «Corregido»); las de las fusiones de #59 (`27a1ff3`) y #63 (`392be79`) figuran como «cancelled», sin trabajos [POR VERIFICAR por qué; [SUPUESTO] el grupo de concurrencia de `main` solo admite una ejecución en espera y GitHub descarta la anterior cuando entra otra, aunque `cancel-in-progress` sea falso en `main`: se fusionaron #59, #63 y #64 en menos de dos minutos] (`gh run list --branch main` y `gh run view`, 25 de noviembre de 2026).
- Los PR #53 a #66 se fusionaron en `main` el 25 de noviembre de 2026, con commit de fusión y en este orden: #60 (`84b0614`, lo fusionó el usuario a las 09:01), #56 (`8767082`), #53 (`9cb7d61`), #55 (`b5f6205`), #59 (`27a1ff3`), #63 (`392be79`), #64 (`5dfa13f`), #57 (`9c89b15`), #54 (`ee47229`), #58 (`a733091`), #62 (`3f6ca93`), #66 (`207b068`) y #65 (`4cd67ad`) (`gh pr list --state merged` y `git log --first-parent origin/main`). Antes de fusionar tenían en verde `api`, `legacy`, `infra` e `imagen`; el `secretos` de los PR apilados salía en rojo por un contagio entre ramas que corrigió el PR #60, el primero que se fusionó. El repositorio borra la rama de cada PR fusionado (solo quedan `main` y las ramas de PR abiertos) y GitHub reorientó solo hacia `main` los PR que estaban apilados [CONFIRMADO: `git ls-remote --heads origin`, `gh pr list --state merged`]. Solo queda sin fusionar el PR #61 (este archivo).
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
