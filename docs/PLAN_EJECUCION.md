# Plan de ejecución de la reconstrucción v2 (V2-M2 a V2-M4)

Fecha: 22 de noviembre de 2026. Estado: [PROPUESTA], pendiente de revisión del usuario.
Complementa a `docs/PLAN_MEJORA.md` (qué se construye y por qué) con el **cómo, en qué orden y con qué reglas**, de forma que se pueda ejecutar sin consultar a nadie en cada paso.
Etiquetas de certeza: [CONFIRMADO] verificado en el repositorio o en GitHub; [PROPUESTA] decidido en este plan, sin construir; [POR VERIFICAR] depende de una prueba o de un dato que falta; [SUPUESTO] sin medir.

## 1. ¿Está todo definido en los issues y el tablero?

**En lo esencial, sí.** Los 20 issues abiertos (#8 a #27) tienen criterios de aceptación, estimación, prioridad, hito y responsable [CONFIRMADO]. **Pero para ejecutarlos sin consultar hay once huecos.** Este plan cierra los que puede y marca los que dependen del usuario.

| N.º | Hueco | Efecto si no se atiende | Cómo lo cierra este plan |
|---|---|---|---|
| 1 | El orden y las dependencias no están en los issues. #8 exige "registro del intento" de acceso denegado, pero la auditoría es #14 | #8 no se puede terminar tal como está escrito | `AuditoriaService.registrar()` nace en #8; #14 completa consulta, inmutabilidad y cobertura (sección 3) |
| 2 | **Defecto de diseño:** la migración 0000 declara `UNIQUE (documento_id, sha256)` en `versiones` [CONFIRMADO]. Restaurar una versión anterior crea una fila con la misma huella en el mismo documento y chocaría con esa restricción | #11 no podría cumplir "restaurar crea una versión nueva" | Migración nueva en #11: columna `restaurada_de` e índice único **parcial** (`WHERE restaurada_de IS NULL`) |
| 3 | La autenticación está sin decidir (sesión o JWT) | #8 se bloquea en la primera decisión | ADR-003: sesiones en el servidor guardadas en PostgreSQL (sección 5, #8) |
| 4 | Las pruebas de integración usan la base de desarrollo [CONFIRMADO] | Desde #8 escriben filas y se contaminan entre sí y con los datos de quien desarrolla | Base de pruebas aparte con limpieza por prueba (Bloque 0) |
| 5 | #12 no define el algoritmo ni su rendimiento: `pg_trgm` sobre texto de PDF largos puede ser lento | Un 5 h estimado puede triplicarse | Prueba de rendimiento con criterio de decisión y alternativa (sección 5, #12) |
| 6 | #12 no elige la librería de extracción de texto | Bloqueo al empezar | `unpdf`, con criterio de cambio |
| 7 | #20 necesita cuentas, tarjeta y permisos que solo tiene el usuario | No se puede desplegar sin él | Se divide: la parte autónoma se prepara antes; la del usuario queda con guion y plazo (sección 6) |
| 8 | Los entregables del curso (informe final, línea base real, pruebas con usuarios, video, póster, socialización) **no están en el tablero**; se eliminaron con los hitos H1 a H6 el 11 de nov. | El desarrollo puede ir bien y el curso fallar por lo que no se ve | Se listan en la sección 6 para que el usuario decida si se vuelven issues |
| 9 | Los títulos de #2 y #10 dicen "MinIO"; se usa RustFS | Confusión ante el docente | Se corrigen cuando el usuario autorice editar issues (sección 6) |
| 10 | No hay PDF de prueba para el reescaneo simulado ni para "sin capa de texto" | #12 y #15 no se pueden probar | Se generan con `pdf-lib` en un asistente de pruebas (sección 5, #12) |
| 11 | "Búsqueda ignora tildes" (#13) no se logra con la configuración `spanish` de PostgreSQL | La prueba más visible fallaría | Configuración de búsqueda propia con `unaccent` (sección 5, #13) |

## 2. Capacidad y calendario

Quedan **60 h estimadas** [SUPUESTO: las estimaciones del plan no se han medido] y 15 días hasta el cierre del curso (7 de diciembre). Son cerca de 4 h por día, todos los días.

| Hito | Vence | Horas | Issues |
|---|---|---|---|
| V2-M2 Núcleo | dom. 29 nov. | 26 | #8 a #16 |
| V2-M3 Nube y usuarios | mié. 2 dic. | 15 | #17 a #22 |
| V2-M4 Interfaz y cierre | lun. 7 dic. | 19 | #23 a #27 |

| Día | Trabajo previsto |
|---|---|
| Dom. 22 nov. | Bloque 0: arreglo del CI, este plan, base de pruebas aparte y #8 |
| Lun. 23 | #14 y #9 |
| Mar. 24 | #10 |
| Mié. 25 | #11 |
| Jue. 26 y vie. 27 | #12 (la tarea más riesgosa) |
| Sáb. 28 | #13 y #15 |
| Dom. 29 | #16, cierre de V2-M2 y colchón |
| Lun. 30 nov. | #17 y #18 |
| Mar. 1 dic. | #20 (parte autónoma) y #19; el usuario hace su parte de #20 |
| Mié. 2 dic. | #21, #22 y cierre de V2-M3 |
| Jue. 3 a lun. 7 dic. | #23, #24, #27 y, si hay tiempo, #25 y #26 |

## 3. Orden de ejecución y dependencias

```
Bloque 0 ─► #8 ─┬─► #14 ─┐
 (CI, base de   │        ├─► #10 ─► #11 ─► #12 ─► #13 ─► #15 ─► #16
  pruebas)      └─► #9 ──┘
                                  #17 ─ #18 ─ #19 ─ #20 ─ #21 ─ #22   (V2-M3)
                                  #23 ─ #24 ─ #25 ─ #26 ─ #27         (V2-M4)
```

- **#14 antes que #9, #10, #11 y #12**, y no después como en el plan original: así cada función nace emitiendo sus eventos de auditoría en vez de añadirlos al final.
- **#15 se hace por partes:** cada función incluye su prueba de aceptación equivalente a una de las 7 del prototipo v1 (tabla en la sección 5, #15). El issue #15 se cierra al final con las que falten y las pruebas de duplicados.
- **#16 va al final de V2-M2**, para documentar el esquema definitivo y no uno que aún cambia.
- **#22 va al final de V2-M3** por la misma razón.

## 4. Protocolo de ejecución sin supervisión

### 4.1 Se hace sin preguntar

Crear ramas; hacer commits; subir ramas; abrir PR con etiquetas, hito y `Closes #n`; ejecutar el CI y corregir sus fallos; mover tarjetas del tablero según el flujo de `CONTRIBUTING.md`; escribir la bitácora y actualizar la memoria del proyecto; añadir dependencias de desarrollo y de ejecución necesarias para el issue.

### 4.2 No se hace sin un sí explícito del usuario

- **Fusionar un PR a `main`.** Ver 4.5.
- Crear, editar o borrar issues, etiquetas, hitos o tableros; cambiar ajustes del repositorio.
- Tocar cuentas, secretos o recursos de GCP, Neon o cualquier servicio externo.
- Subir datos reales de la entidad o de personas. Solo datos ficticios.
- Reescribir el historial, hacer force push o retrodatar commits.
- Entrar en lo excluido por `CLAUDE.md`: servidor, red, UPS, rack, TRD y TVD definitivas, digitalización retroactiva del archivo histórico.
- Presentar como dato real una cifra marcada [SIMULADO].

### 4.3 Ciclo de cada issue

1. `git checkout main && git pull`, o sobre la rama del issue anterior si depende de él (4.5).
2. Rama `<tipo>/<n>-descripcion` y tarjeta a "En progreso".
3. Leer el issue y la sección correspondiente de este plan. Si hay una decisión nueva, escribirla antes de codificar (ADR o sección 8).
4. Implementar en commits pequeños.
5. Verificar (4.4).
6. Abrir el PR con la plantilla, etiquetas, hito y `Closes #n`. Tarjeta a "En revisión".
7. Esperar el CI; corregir hasta tres veces (4.6).
8. Escribir la entrada de la bitácora con lo hecho, lo decidido, lo pendiente y lo que **no** se pudo verificar.

### 4.4 Verificación mínima antes de abrir un PR

Desde una instalación limpia y con la infraestructura arriba:

```
npm ci && npm run lint && npm test && npm run test:e2e && npm run build
```

Además, para todo issue que cambie comportamiento visible por HTTP: **ejecutar la API compilada y probar el flujo real con `curl`**, incluida la ruta de error. Las pruebas automáticas no sustituyen esto: en #6 fue el servidor compilado real el que confirmó que `/health` pasa a 503 al caer la base y se recupera sin reiniciar la API.

Si el issue toca el esquema: probar la migración sobre una base vacía **y** sobre una con datos de la migración anterior.

### 4.5 Fusiones

- **Por defecto no se fusiona.** Los PR quedan abiertos con el CI en verde, a la espera del usuario. Cuando un issue depende de otro sin fusionar, su rama parte de la rama del anterior y su PR apunta a esa rama (`gh pr create --base <rama anterior>`). Al fusionar el primero en orden, GitHub reenfoca el siguiente a `main`. **Corrección del 22 de noviembre (16:50): una cadena de PR apilados se fusiona con «Create a merge commit», no con squash.** Simulé fusionar la cadena real (#35 a #47) sin tocar ninguna rama (`git merge-tree`): con squash, **7 de las 13 fusiones dan conflicto** con lo ya fusionado (sobre todo `README.md`, `apps/api/drizzle/meta/_journal.json`, `apps/api/src/auditoria/acciones.ts`, `docs/adr/README.md` y `apps/api/src/app.module.ts`), porque el squash reescribe el historial y el PR siguiente todavía trae los commits originales; con commit de fusión, **las 13 son limpias**. El repositorio permite los tres métodos. Una alternativa con squash es rebasar cada rama sobre `main` después de cada fusión (`git rebase --onto main <rama anterior> <rama>` y empujar), pero son diez rebases a mano.
- El usuario puede **autorizar fusionar de forma continua** con una frase. Con esa autorización, cada PR se fusiona (con commit de fusión si tiene PR apilados detrás, como se explicó arriba; con squash solo si es independiente; y borrando la rama) solo si: el diff está revisado, el CI está en verde, no hay observaciones pendientes en 4.8 y los criterios de aceptación están verificados.
- La autorización es **por alcance**: lo que no nombre, no cubre.

### 4.6 Manejo de fallos

- **CI en rojo:** diagnosticar la causa, corregir y subir. Hasta **tres intentos**. Si al tercero sigue en rojo, el PR se marca como borrador, se anota el diagnóstico en el PR y en la bitácora, y se pasa al siguiente issue que no dependa de este.
- **Una prueba falla de forma intermitente:** no se reintenta hasta que pase. Se investiga la causa; una prueba que a veces falla es un defecto.
- **Un criterio de aceptación no se puede cumplir tal como está escrito:** no se reinterpreta en silencio. Se cumple lo posible, se documenta la diferencia en el PR (como se hizo con RustFS en el #2) y se avisa en la bitácora.
- **Dependencia o herramienta incompatible:** se verifican las versiones y sus rangos de compatibilidad antes de elegir (como se hizo con TypeScript 6 y 7). No se fija una versión de memoria.

### 4.7 Registro

Una entrada de bitácora por bloque de trabajo, con el formato de `CLAUDE.md` (hecho, decisiones, archivos, pendientes, fuentes) y las etiquetas de certeza. Las decisiones que cambian el diseño van además a un ADR o a la sección 8 de este plan, con fecha, motivo y alternativas descartadas. No se retrodatan commits ni registros.

### 4.8 Cuándo detenerse y avisar

Detenerse y dejar escrito el motivo si ocurre algo de esto:

- Hace falta algo de 4.2.
- Un cambio rompe pruebas de un issue ya terminado y no se resuelve en tres intentos.
- Se descubre que una decisión del plan es errónea (como el hallazgo 2 de la sección 1): documentarla, proponer la corrección y continuar solo con lo que no depende de ella.
- Se acaba el tiempo previsto del bloque y el estado no es coherente (rama a medias, migración sin probar): dejar la rama en un estado que compile y pase, o borrador.

## 5. Plan por issue

Convenciones: **Rama** · **Depende de** · **Pasos** · **Pruebas** · **Verificación** · **Riesgos**.

### Bloque 0: antes de #8

**0.1 Corregir la concurrencia del CI.** Rama `ci/no-cancelar-en-main`. El `cancel-in-progress: true` actual canceló dos ejecuciones sobre `main` al fusionar seguidas [CONFIRMADO]; un fallo intermedio quedaría oculto. Cambiar a `cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}`. Verificar con `actionlint` y con el propio PR. Excepción a "todo cambio parte de un issue": es una corrección de mantenimiento de un defecto propio, y el PR lo explica.

**0.2 Este plan** (rama `docs/plan-ejecucion`).

**0.3 Base de pruebas aparte** (dentro del PR de #8). `test/preparar-entorno.ts` toma `DATABASE_URL_TEST` si existe; si no, usa la `DATABASE_URL` cambiando el nombre de la base a `<nombre>_test`, la crea si no existe (conectando a la base `postgres` con las mismas credenciales) y aplica las migraciones. Un asistente `test/ayudas.ts` ofrece `crearApp()` y `limpiarTablas()` (`TRUNCATE ... RESTART IDENTITY CASCADE`). En el CI, `DATABASE_URL_TEST` apunta a la base efímera del servicio. **Verificación:** que las pruebas de integración ya no escriban en la base `faro`.

### #8 Ingreso y roles (3 h) · rama `feat/8-auth-roles`

- **Depende de:** Bloque 0.
- **Decisión (ADR-003):** sesiones en el servidor guardadas en PostgreSQL. Una cookie `faro_sesion` con un token aleatorio de 32 bytes; en la base solo se guarda su SHA-256 (`sesiones`: `id`, `usuario_id`, `creada_en`, `expira_en`, `ultimo_uso`). Caduca a las 8 h de inactividad. *Por qué:* sobrevive a reinicios y a varias instancias (criterio del issue) y desactivar un usuario (#17) cierra sus sesiones al instante, algo que un JWT no permite sin una lista de revocación. *Descartado:* JWT (revocación), sesión en memoria (el problema del prototipo), Redis (otro servicio que operar).
- **Pasos:**
  1. ADR-003.
  2. Migración 0001: tabla `sesiones`.
  3. `argon2` (argon2id). Antes de fijarlo, comprobar que instala en Windows y en el CI de Linux; si no, `@node-rs/argon2`.
  4. Módulo `auth`: `POST /auth/login`, `POST /auth/logout`, `GET /auth/yo`; `AuthGuard` global (todo exige sesión salvo lo marcado `@Publico()`, como `/health` y el ingreso); `RolesGuard` con `@Roles(...)`.
  5. Cookie `httpOnly`, `SameSite=Lax`, `Secure` en producción.
  6. Verificar siempre una clave aunque el usuario no exista (hash falso), para no revelar por el tiempo de respuesta qué usuarios existen.
  7. `AuditoriaService.registrar()` y su uso para ingreso, cierre de sesión, ingreso fallido y **acceso denegado** (403).
  8. Siembra `npm run db:seed -w apps/api`: tres usuarios ficticios (administrador, editor, consulta). La clave sale de una variable de entorno de la siembra, definida en `.env.example`.
- **Pruebas:** unitarias (hash y verificación, decisiones del guard con repositorios falsos). Integración: ingreso correcto e incorrecto; usuario inactivo no ingresa; ruta protegida sin sesión da 401; `/health` sigue público; **403 por rol y evento `acceso_denegado` registrado**; el cierre de sesión invalida; **una sesión sobrevive a reiniciar la aplicación** (segunda instancia sobre la misma base); sesión caducada.
- **Equivale a las pruebas v1:** 1 (credenciales y sesión), 3 (rol de consulta), parte de 6 (auditoría solo para el administrador).
- **Riesgos:** instalación del paquete nativo de `argon2`; que el 403 sin sesión se confunda con 401.

### #14 Auditoría (2 h) · rama `feat/14-auditoria` · depende de #8

- Completar lo que #8 deja: `GET /auditoria` (solo administrador) con filtros por usuario, acción, documento y rango de fechas, y paginación.
- **Inmutabilidad:** además de no exponer edición ni borrado por la API, un disparador de base de datos que rechace `UPDATE` y `DELETE` sobre `auditoria`. Los `TRUNCATE` de las pruebas no se ven afectados.
- Catálogo de acciones como constantes compartidas. Cada issue siguiente emite las suyas: #10 `carga`; #11 `version`, `restauracion`, `descarga`; #12 `decision_duplicado`; #17 `usuario_creado`, `usuario_desactivado`, `rol_cambiado`.
- **Pruebas:** un intento de `UPDATE` o `DELETE` por SQL falla; un editor recibe 403 en la consulta; los filtros y la paginación.
- **Equivale a la prueba v1** 6.

### #9 Cuadro de clasificación (2 h) · rama `feat/9-ccd` · depende de #8

- Reutilizar el cuadro ficticio de `legacy/prototipo-v1/seed/sembrar.js`, en una siembra **idempotente** (actualiza por `codigo`).
- `GET /series` devuelve el árbol y cualquier rol lo ve.
- **Solo las subseries admiten documentos:** regla en el servicio (`SeriesService.esSubserie`) y, como defensa adicional, un disparador que rechace un `documentos.serie_id` cuya serie no tenga `padre_id` [PROPUESTA].
- **Pruebas:** la siembra repetida no duplica; asociar un documento a una serie raíz es rechazado por el servicio y por la base.

### #10 Carga de documentos (3 h) · rama `feat/10-carga` · depende de #8, #9 y #14

- **Puerto `AlmacenArchivos`:** `guardar(clave, datos, tipo)`, `leer(clave)`, `existe(clave)`, `borrar(clave)`. Adaptadores `AlmacenDisco` (pruebas y desarrollo sin Docker) y `AlmacenS3` (`@aws-sdk/client-s3` con `forcePathStyle`, para RustFS y para Cloud Storage en modo interoperable). Se elige con `ALMACEN_TIPO`.
- **Clave determinista:** `documentos/<sha256>.pdf`. Guardar el mismo contenido dos veces es inocuo.
- **Validación:** firma `%PDF-` (no solo la extensión ni el tipo MIME) y límite de 20 MB, que se rechaza antes de leer todo el cuerpo.
- **Carga sin estados a medias** (criterio del issue): 1) calcular la huella; 2) guardar el objeto; 3) en **una transacción**, insertar documento, versión 1 y evento de auditoría; 4) si la transacción falla, borrar el objeto **solo si ninguna versión lo referencia**. Si el proceso muere entre 2 y 3 queda un objeto huérfano: un guion `npm run almacen:huerfanos` los lista (y borra con `--borrar` los de más de una hora) [PROPUESTA].
- Endpoints: `POST /documentos` (multipart), `GET /documentos/:id`, `GET /documentos` (listado simple; la búsqueda llega en #13), `GET /documentos/:id/versiones/:n/archivo` (descarga, con evento `descarga`).
- **CI:** añadir un contenedor RustFS al trabajo `api` para ejecutar las pruebas del adaptador S3 de verdad; las mismas pruebas del puerto se corren contra los dos adaptadores.
- **Pruebas:** rechazo de no-PDF, de más de 20 MB y de datos incompletos (**prueba v1** 5); carga correcta; fallo simulado de la transacción deja el almacén sin huérfanos; descarga por el rol de consulta.

### #11 Versiones y restauración (3 h) · rama `feat/11-versiones` · depende de #10

- **Migración 0002 (corrige el hallazgo 2):** columna `restaurada_de integer null` en `versiones`; quitar `versiones_documento_sha256_uq` y crear un índice único **parcial** `(documento_id, sha256) WHERE restaurada_de IS NULL`. Así subir un archivo idéntico a uno ya existente del mismo documento sigue siendo imposible, y restaurar sí.
- Endpoints: `POST /documentos/:id/versiones` (archivo y motivo obligatorio), `GET /documentos/:id/versiones`, `POST /documentos/:id/versiones/:n/restaurar`.
- Restaurar crea la versión N+1 que apunta al mismo objeto, con motivo "Restaura la versión n" y `restaurada_de = n`. No copia el archivo.
- Numeración sin huecos y sin carreras: `SELECT ... FOR UPDATE` sobre el documento dentro de la transacción.
- **Pruebas:** historial con autor, fecha y motivo; restaurar crea una versión nueva (**no** una fila editada); dos versiones simultáneas no repiten número; subir el mismo archivo de nuevo da 409; rol de consulta no versiona (**prueba v1** 2, 3).
- **Riesgo:** la migración debe probarse sobre una base que ya tenga versiones.

### #12 Verificación doble (5 h) · rama `feat/12-duplicados` · depende de #10 y #11

- **Primero una prueba de rendimiento (máx. 1 h):** corpus ficticio de 100 documentos de unas 100 páginas. Medir la consulta de similitud con `pg_trgm`. **Criterio:** si el p95 es menor de 2 s, se sigue con `pg_trgm`; si no, se cambia a una huella de similitud calculada en la aplicación (SimHash) y se guarda por versión, y se registra en el ADR-004. El resultado y la decisión se escriben en el PR.
- **Extracción:** `unpdf` (se cambia solo si falla con los PDF generados por `pdf-lib`). Normalizar a minúsculas, sin tildes, sin signos y con espacios únicos. Guardar `versiones.texto_normalizado` y `texto_estado` (`ok` o `sin_texto`). Migración 0003: extensión `pg_trgm` y el índice.
- **Decisión** (plan, sección 5):
  - SHA igual: **409** con la ubicación del existente.
  - SHA distinto y similitud mayor o igual al umbral (`UMBRAL_SIMILITUD`, por defecto 0,90): **409** con `duplicado_probable` y los candidatos (documento, versión, similitud, ubicación). El usuario reenvía el archivo con `decision=nueva_version` (y el id del documento) o `decision=documento_distinto` con justificación. Reenviar el archivo evita guardar estados intermedios en el servidor.
  - PDF sin capa de texto: se marca y solo se verifica por huella.
  - La similitud **nunca bloquea sola**.
  - Cada decisión se audita (`decision_duplicado`).
- **Pruebas:** un generador `pdf-lib` crea los PDF: el original, un **reescaneo simulado** (mismo texto, otros bytes por metadatos y fecha), un PDF distinto con la misma plantilla y un PDF sin capa de texto. Se prueban los cuatro caminos de la tabla y que la decisión queda en la auditoría (**prueba v1** 4, ampliada).
- **Riesgo alto.** Si tras 5 h el rendimiento o la extracción no están resueltos, se entrega el camino de huella exacta y se deja la similitud en un PR borrador documentado. La calibración del umbral con PDF reales requiere autorización de la entidad: queda como [POR VERIFICAR].

### #13 Búsqueda (3 h) · rama `feat/13-busqueda` · depende de #12

- **Migración 0004:** extensión `unaccent` [POR VERIFICAR su disponibilidad en Neon] y una configuración de búsqueda `es_sin_tildes` (copia de `spanish` con el diccionario `unaccent`). `unaccent` no es inmutable, así que no se usa dentro de una columna generada: la configuración propia sí permite `to_tsvector('es_sin_tildes', ...)`.
- `documentos.busqueda` (`tsvector`) con título, expediente y texto de la versión vigente, mantenida por el servicio dentro de la misma transacción de carga o de nueva versión; índice GIN.
- `GET /documentos?q=&serieId=&pagina=&tamano=` devuelve `{ items, total, pagina, tamano }`, ordenado por `ts_rank`; tamaño máximo de página 50.
- **Pruebas:** `interventoria` encuentra "interventoría" (**prueba v1** 2); la paginación no repite ni pierde elementos; el filtro por serie; consulta vacía.

### #15 Pruebas de aceptación (3 h) · rama `test/15-aceptacion` · depende de #13

| Prueba v1 | Cubierta en |
|---|---|
| 1. Credenciales incorrectas y exige sesión | #8 |
| 2. Carga, búsqueda sin tildes, versión e historial | #10, #11, #13 |
| 3. El rol de consulta lee y descarga, pero no modifica | #8, #10, #11 |
| 4. Detecta un archivo ya digitalizado | #12 |
| 5. Rechaza no-PDF y datos incompletos | #10 |
| 6. Solo el administrador ve la auditoría | #8, #14 |
| 7. Los datos persisten al reiniciar la aplicación | #15 (reiniciar la app y comprobar documentos, versiones y sesión) |

Este issue añade la 7, un recorrido completo que las encadena y las pruebas unitarias de los servicios de duplicados y versiones. Se cierra con el CI en verde.

### #16 Modelo de datos (2 h) · rama `docs/16-modelo-de-datos` · depende de #15

`docs/modelo-de-datos.md` con un diagrama ER en Mermaid (GitHub lo dibuja) y el diccionario por tabla y campo. Una prueba compara las columnas documentadas con `information_schema` para que el documento no quede desactualizado [PROPUESTA].

### V2-M3

- **#17 Usuarios (3 h)** · `feat/17-usuarios`. `POST /usuarios`, `PATCH /usuarios/:id` (rol, activo). Desactivar borra sus sesiones. Impedir que el último administrador se desactive o se degrade. Auditoría de cada acción. Pruebas: editor recibe 403, inactivo no ingresa.
- **#18 Seguridad (2 h)** · `feat/18-seguridad`. CSRF: con cookie `SameSite=Lax`, exigir un encabezado propio (`X-CSRF-Token` con doble envío) en métodos que modifican. Límite de intentos por usuario y por IP (`@nestjs/throttler` más bloqueo temporal guardado en la base). Cabeceras con `helmet`. **Sin secretos en el repositorio:** un trabajo de CI con `gitleaks` [PROPUESTA].
- **#19 CSV del cuadro (2 h)** · `feat/19-csv-ccd`. Importación con validación completa antes de aplicar (todo o nada), sin borrar series que ya tengan documentos. CSV ficticio de prueba.
- **#20 Despliegue (4 h), dividido:**
  - *Autónomo:* `Dockerfile` de varias etapas para la API, `.dockerignore`, prueba local del contenedor junto con Postgres y RustFS, `docs/despliegue.md` con un guion paso a paso, y el flujo `deploy.yml` por `workflow_dispatch`, con autenticación **Workload Identity Federation** (sin llaves JSON en el repositorio), inactivo hasta que existan las variables.
  - *Del usuario* (sección 6): cuenta de GCP y de Neon, alerta de presupuesto **antes** del primer despliegue, y configurar la federación. Unos 30 a 45 min siguiendo el guion.
  - Verificar las cuotas gratuitas en las páginas oficiales el día de desplegar [POR VERIFICAR].
- **#21 Copia de seguridad (2 h)** · `chore/21-respaldo`. `pg_dump` programado hacia un bucket **privado**. **No** usar artefactos de GitHub Actions: en un repositorio público cualquiera puede descargarlos. Guía de restauración probada una vez en una base temporal local.
- **#22 Matriz de roles y diagrama (2 h)** · `docs/22-matriz-y-arquitectura`. La matriz se verifica contra las guardas reales con una prueba que recorre los endpoints.

### V2-M4

- **Decisión:** la API sirve la interfaz ya compilada (un solo contenedor y un solo origen). Evita CORS y cookies entre sitios. Se registra en el ADR-005 al empezar #23.
- **#23 Ingreso, listado y detalle (6 h)** · `feat/23-web-listado`. `apps/web` con React, Vite y TypeScript; React Router; un cliente HTTP tipado escrito a mano (la API es pequeña); CSS propio, sin biblioteca de componentes. Servidor de desarrollo con proxy a la API. Responsivo en celular.
- **#24 Carga, versión y duplicado (5 h)** · `feat/24-web-carga`. Pantalla de comparación de duplicado probable con ambos documentos y la decisión.
- **#25 Usuarios y auditoría (3 h, prioridad *could*)** · `feat/25-web-admin`.
- **#26 Prueba e2e con Playwright (3 h, *could*)** · `test/26-e2e`. Corre en el CI.
- **#27 CHANGELOG, `v2.0.0` y manual (2 h)** · `docs/27-release`. El manual de usuario es un documento de la materia: [POR VERIFICAR] si lo redacta Juan o César.

## 6. Lo que necesita del usuario

| N.º | Qué | Para cuándo | Si no llega |
|---|---|---|---|
| 1 | **Autorizar fusionar de forma continua** (4.5) | Hoy | El trabajo se acumula en PR apilados que hay que fusionar en orden |
| 2 | Abrir **Issues → New issue** y comprobar que aparecen las cuatro plantillas (GitHub no las lista por API; el CONTRIBUTING y la plantilla de PR sí se reconocen) | Hoy, 1 min | Si no aparecen, se corrige en un PR |
| 3 | **Cuentas de GCP y Neon** y alerta de presupuesto (#20, guion en `docs/despliegue.md`) | Lun. 30 nov. | No hay despliegue; V2-M3 se cierra sin #20 |
| 4 | Decidir si los **entregables del curso** (informe final, pruebas con usuarios, línea base real de re-escaneo, video, póster, socialización) se vuelven issues | Esta semana | Quedan fuera del tablero y del seguimiento |
| 5 | Autorizar **editar los títulos** de #2 y #10 (dicen MinIO) | Cuando quiera | Queda la inconsistencia |
| 6 | **Autorización escrita de la entidad** para usar PDF reales y calibrar el umbral (#12) | Antes de calibrar | Se usan solo PDF ficticios y el umbral queda [POR VERIFICAR] |
| 7 | Reemplazar las cifras [SIMULADO] de re-escaneo por la línea base real | Antes de la comparación (H5) | Se presentan como [SIMULADO], nunca como hechos |
| 8 | Confirmar con César qué documentos de la materia le tocan | Esta semana | Sin dueño para el manual (#27) ni los entregables |

## 7. Riesgos, puntos de control y recortes

**Riesgos principales:** #12 (algoritmo y rendimiento), #20 (depende del usuario y de cuotas externas), el volumen total (4 h por día durante 15 días seguidos, sin medir cuánto cuesta en realidad cada issue) y que un solo desarrollador concentre todo.

**Puntos de control:** si al terminar la fecha indicada falta más de **6 h** de lo previsto, se aplica el recorte de la lista de abajo y se anota en la bitácora.

| Fecha | Debe estar |
|---|---|
| Mar. 24 nov. | #8, #14 y #9 con PR abierto y CI en verde |
| Jue. 26 nov. | #10 y #11 con PR abierto |
| Sáb. 28 nov. | #12 y #13 con PR abierto |
| Dom. 29 nov. | V2-M2 completo |
| Mié. 2 dic. | V2-M3 completo |
| Lun. 7 dic. | `v2.0.0` publicada |

**Orden de recorte** (primero lo que menos daña):

1. #26 (e2e) y #25 (administración en la interfaz): son *could*.
2. #21 (copia programada): queda la guía de restauración y el comando manual.
3. #19 (CSV del cuadro): la siembra basta para la demostración.
4. #22 y #16 se reducen a lo mínimo verificable.
5. Nunca se recorta: verificación doble por huella exacta, auditoría, roles, versiones con restauración, despliegue de pruebas e interfaz de ingreso, listado y carga.

## 8. Decisiones de este plan

13. [PROPUESTA] **Orden:** #14 antes de #9 a #12, y #15 por partes. *Motivo:* #8 exige el registro de accesos denegados y cada función debe nacer emitiendo su auditoría. *Descartado:* mantener el orden numérico (obliga a retocar cada función después).
14. [PROPUESTA] **Sesiones en el servidor guardadas en PostgreSQL** (ADR-003 en #8). *Descartado:* JWT, sesión en memoria, Redis.
15. [PROPUESTA] **Índice único parcial en `versiones`** con `restaurada_de` (#11), para corregir el defecto de la migración 0000.
16. [PROPUESTA] **Fusión por defecto manual**, con PR apilados mientras el usuario no autorice fusionar de forma continua. *Motivo:* fusionar a `main` es una acción visible y la autorización de hoy cubrió solo #2, #6, #3 y los PR #32 a #34.
17. [PROPUESTA] **La API sirve la interfaz compilada** (un solo origen). *Descartado:* servir la interfaz aparte (CORS y cookies entre sitios).
18. [PROPUESTA] **Copias de seguridad a un bucket privado**, nunca como artefacto de Actions en un repositorio público.
19. [PROPUESTA] **Regla de recorte** de la sección 7, para decidir sin consultar cuando el tiempo no alcance.
20. [CONFIRMADO] **Los PR apilados se fusionan con commit de fusión, no con squash.** *Evidencia:* simulación del 22 nov con `git merge-tree` sobre la cadena real: squash da 7 conflictos en 13 fusiones, commit de fusión da 0 (sección 4.5). *Descartado:* squash con rebase manual de cada rama (diez rebases a mano, propenso a errores).

## 9. Estado de ejecución (22 de noviembre de 2026, 16:47)

Lo que quedó hecho en esta sesión sin supervisión. **Todo está en PR abiertos con el CI en verde, sin fusionar** (no hay autorización para fusionar). Este registro es lo que realmente pasó; si algo difiere de la sección 5, vale este.

| Issue | PR | Rama | ADR | Migración | Diferencia con la sección 5 |
|---|---|---|---|---|---|
| #8 ingreso, sesiones y roles | #37 | `feat/8-auth-roles` | 003 | 0001 | — |
| #14 auditoría inmutable | #38 | `feat/14-auditoria` | — | 0002 | — |
| #9 cuadro de clasificación | #39 | `feat/9-ccd` | — | 0003 | — |
| #10 almacén y carga | #40 | `feat/10-carga` | 004 | — | — |
| #11 versiones y restauración | #41 | `feat/11-versiones` | 005 | 0004 | — |
| #12 duplicados | #42 | `feat/12-duplicados` | 006 | 0005 | **MinHash propio en lugar de `pg_trgm`**: se midió (p95 de 15 s y sin discriminar documentos largos) y se descartó |
| #13 búsqueda | #43 | `feat/13-busqueda` | 007 | 0006 | **Normaliza en la aplicación y usa `spanish`, sin `unaccent` ni `es_sin_tildes`** (el texto ya llega normalizado; `unaccent` es una extensión) |
| #15 aceptación | #44 | `test/15-aceptacion` | — | — | Las 7 pruebas de v1, más 41 unitarias de versiones y duplicados |
| #16 modelo de datos | #45 | `docs/16-modelo-de-datos` | — | — | Una prueba lo compara con la base: el CI falla si queda desactualizado |
| #17 usuarios | #46 | `feat/17-usuarios` | 008 | — | Sin cambio de clave ni restablecimiento (hueco anotado en el ADR-008) |
| #20 despliegue, parte autónoma | #47 | `feat/20-despliegue` | — | — | `Refs #20`: tres criterios son del usuario; el despliegue es manual, no automático desde `main` |

Fuera de la cadena: **#35** (este plan) y **#36** (el CI no cancela en `main`), ambos contra `main`.

**Lo que no se hizo:** #18 (CSRF, límite de intentos de ingreso, helmet y gitleaks), #19 (CSV del cuadro), #21 (copia de seguridad), #22 (matriz de roles y diagrama) y todo V2-M4 (#23 a #27). Se adelantó la parte autónoma de #20 a #18 porque el guion de despliegue desbloquea al usuario para sus cuentas de GCP y Neon (sección 6, punto 3). Mientras #18 no exista, **no conviene publicar la dirección del despliegue**: no hay límite de intentos de ingreso ni protección CSRF.

**Para fusionar:** en orden `#35, #36, #37, #38, … #47`, cada uno con **«Create a merge commit»** (sección 4.5, decisión 20). Tras cada fusión, GitHub reenfoca el siguiente a `main`; conviene esperar a que el CI de `main` termine antes de la siguiente. Las migraciones se aplican a mano en cada base existente (`npm run db:migrate -w apps/api`; la API no migra al arrancar).

**Hallazgos que cambian cosas más adelante:**
- Nadie puede cambiar su clave ni restablecer la de otro (ADR-008, sección 4): conviene un issue aparte antes de usar el sistema con más personas.
- `versiones` no tiene un disparador que impida editar o borrar filas, como sí lo tiene `auditoria`; hoy lo cumple solo la aplicación (`docs/modelo-de-datos.md`, sección 2).
- Un PDF idéntico a otro ya cargado se rechaza siempre, aunque sea de otro expediente. [POR VERIFICAR con la entidad] si un mismo archivo puede pertenecer legítimamente a dos expedientes.
- El umbral de similitud de 0,80 es provisional hasta calibrarlo con PDF reales (necesita autorización escrita de la entidad, sección 6, punto 6).
