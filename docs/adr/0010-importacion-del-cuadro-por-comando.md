# ADR-010: Importación del cuadro de clasificación por línea de comandos: simulación por defecto, todo o nada y sin tocar lo que tiene documentos

- **Fecha:** 22 de noviembre de 2026
- **Estado:** Aceptada al fusionar este documento
- **Issue:** #19 (HU-07, 1.4.2)
- **Relacionada con:** ADR-002 (arquitectura modular), ADR-008 (el primer administrador también se crea por línea de comandos), `docs/despliegue.md` (el cuadro llega vacío a la nube), `docs/modelo-de-datos.md` (disparador `series_ccd_reglas`)
- **Etiquetas de certeza:** [CONFIRMADO] construido y verificado en el repositorio; [PROPUESTA] decidido pero aún no construido o sujeto a la validación de la entidad; [POR VERIFICAR] falta un dato o una prueba; [SUPUESTO] razonable pero sin medir; [DESCARTADO] se consideró y no se hizo.

## 1. Contexto

Cada documento se clasifica en una subserie del cuadro (`series_ccd`, dos niveles: serie y subserie). Hoy el cuadro sale de la siembra de desarrollo (`semilla/ccd-demo.ts`), que **se niega a correr en producción**, y por eso en la nube el cuadro llega vacío y no se puede cargar ningún documento. El cuadro lo valida la encargada del archivo de la entidad (tarea de la entidad, [POR VERIFICAR] cuándo estará); el prototipo solo necesita una forma segura de cargarlo cuando exista y de cargar uno ficticio mientras tanto.

Restricciones que condicionan el diseño:

- El cuadro es **el eje de la clasificación**: renombrar una serie es inocuo, pero mover o borrar una que ya tiene documentos cambia o rompe la clasificación de documentos que ya existen (y, ante un ente de control, de expedientes). La base ya impide lo más grave (una subserie con documentos no puede volver a ser serie, y no se puede borrar una serie referenciada), pero no impide **mover** una subserie con documentos a otra serie.
- Elaborar las TRD/TVD definitivas está fuera del alcance del proyecto: esto carga un cuadro que alguien más validó, no lo diseña.
- No se agregan dependencias (el `package-lock.json` tiene un solo dueño esta noche y el formato es pequeño).
- Debe correr con la misma imagen del contenedor, como `migrar-cli` y `crear-administrador` (ADR-008).

## 2. Decisión

### 2.1 Un comando, no un endpoint [CONFIRMADO en #19]

`npm run ccd:importar -w apps/api -- <archivo.csv> [--aplicar] [--eliminar-ausentes]` (en la imagen: `node apps/api/dist/ccd/importar/importar-cli.js <archivo.csv> ...`). Sigue el patrón de `crear-administrador` y `migrar-cli`: valida el entorno con `validarEntorno`, abre su propio pool fuera de Nest, imprime en español y termina con un código de salida (0 correcto; 1 archivo inválido o en conflicto con documentos, sin escribir nada; 2 uso incorrecto). El código está en `apps/api/src/ccd/importar/`, con la lógica separada del arranque para probarla sin lanzar procesos.

Como no es un endpoint, **no cambia la matriz de roles**: ningún rol puede modificar el cuadro por la API. Quien puede importar es quien tiene la `DATABASE_URL`, que ya puede hacer cualquier cosa en la base.

### 2.2 Formato del CSV [CONFIRMADO en #19]

Tres columnas, en cualquier orden y con cualquier mayúscula o tilde en la cabecera: `codigo`, `nombre` y `codigo_padre`. Padre vacío = **serie**; con padre = **subserie** de esa serie. El archivo es **el cuadro completo y autocontenido**: todo padre que se nombra tiene su propia fila, así el mismo archivo da el mismo resultado en cualquier entorno.

El lector (`csv.ts`, sin dependencias) acepta UTF-8 con o sin BOM, saltos CRLF, LF o CR, comillas con comas, separadores y saltos dentro, y líneas vacías; el separador (coma o punto y coma, que es lo que guarda Excel en español) se detecta en la cabecera. Rechaza, con la línea, las comillas sin cerrar o mal puestas. Los espacios sobrantes se limpian y los nombres se normalizan a NFC. **Exige UTF-8 y no intenta adivinar otra codificación**: Excel en Windows guarda por defecto en ANSI, y leerlo como UTF-8 dañaría las tildes sin avisar, así que el archivo se rechaza con la instrucción «guárdalo como CSV UTF-8».

### 2.3 Validación completa antes de escribir [CONFIRMADO en #19]

`validarCuadro` informa **todos** los problemas juntos, cada uno con su número de línea: código vacío, repetido (o que solo difiere en mayúsculas), con caracteres que no sean letras, números y `.` `-` `_` entre ellos, o de más de 32 caracteres; nombre vacío, de más de 200 caracteres o con caracteres de control; padre que no está en el archivo (con la pista «¿quiso decir…?» si solo cambia la mayúscula); padre que a su vez tiene padre (tercer nivel); una serie que es su propio padre; ciclos; filas con campos de más (casi siempre una coma sin comillas dentro de un nombre); columnas que faltan o se repiten; más de 2000 filas o 1 MiB. Las columnas desconocidas se ignoran con un aviso. Los límites son [PROPUESTA]: el esquema (`text`) no los impone, los fija la importación.

### 2.4 Simulación por defecto [CONFIRMADO en #19]

Sin `--aplicar` el comando calcula y muestra qué haría (series nuevas, nombres que cambiarían, series que se moverían, series ausentes del archivo) y **no escribe nada**, ni en el cuadro ni en la auditoría. Con `--aplicar` escribe. La simulación sale con 1 si lo que se pide chocaría con documentos, para que un guion pueda detectarlo.

### 2.5 Qué se toca y qué no [CONFIRMADO en #19]

Se compara por **código** (es lo que la entidad conoce y no cambia; el identificador es interno y el nombre sí cambia):

| En el archivo | En la base | Qué ocurre |
|---|---|---|
| Código nuevo | No está | Se crea (las series antes que las subseries) |
| Mismo código y nombre distinto | Está | Se renombra (el nombre no es la identidad: es seguro aunque haya documentos) |
| Subserie con otra serie | Subserie **sin** documentos | Se mueve de serie |
| Subserie con otra serie | Subserie **con** documentos | **Conflicto: se niega todo** |
| Serie declarada subserie, o al revés | Está con el otro nivel | **Conflicto: se niega todo** (un código existente no cambia de nivel; se usa otro código) |
| Ausente del archivo | Está | Se **conserva** y se informa (ver 2.6) |

Con cualquier conflicto **no se escribe nada**, ni lo demás que sí era válido: un cuadro a medias, que nadie validó, es peor que ninguno.

La escritura es **una sola transacción** (series, subseries, renombres, movimientos, eliminaciones y evento de auditoría): si algo falla, el cuadro queda como estaba (probado haciendo fallar a propósito el último paso).

Dentro de la transacción, antes de contar los documentos de cada subserie, se **bloquean con `SELECT ... FOR UPDATE` todas las filas del cuadro** (son decenas). Cargar un documento toma, por la clave foránea, un bloqueo compartido de su subserie: sin este bloqueo, un documento que se está cargando en ese instante no se vería al contar y la regla «no se mueve lo que tiene documentos» tendría una carrera. Con él, la importación espera a que esa carga termine y la cuenta (probado con un documento sin confirmar; la prueba falla si se quita el bloqueo).

### 2.6 Lo ausente no se borra salvo que se pida, y aun así nunca con documentos [CONFIRMADO en #19]

Lo que está en la base y el archivo no menciona **solo se informa**. Con `--eliminar-ausentes` se eliminan (subseries primero y series después) las filas sin documentos; **nunca** una subserie con documentos ni una serie con una subserie con documentos: esas se conservan y se informan, no es un error. Las series ausentes que no se eliminan quedan en el informe con el motivo.

### 2.7 Idempotencia y auditoría [CONFIRMADO en #19]

Repetir el mismo archivo no cambia nada: no hay escritura ni evento. Cuando hay cambios se registra **un** evento `ccd_importado` con `usuario_id` vacío (el esquema lo permite: es un comando, no una petición con sesión), cuyo detalle trae el nombre del archivo y su SHA-256 (qué archivo exacto produjo el cambio), cuántas series se crearon, renombraron, movieron y eliminaron (con los códigos de las movidas y las eliminadas, hasta 20) y cuántas ausentes se conservaron. La acción está en `auditoria/acciones.ts` y en `docs/modelo-de-datos.md` (sección 8). **Sin migración:** `auditoria.accion` es texto.

### 2.8 CSV ficticio [CONFIRMADO en #19]

`docs/ejemplos/cuadro-ejemplo.csv`: 5 series y 10 subseries inventadas (sin datos de la entidad). Sirve de ejemplo en el README y de entrada de las pruebas; contiene las del cuadro de la siembra más algunas nuevas, de modo que sobre una base sembrada muestra «agrega lo nuevo y no toca lo demás».

## 3. Alternativas descartadas

- **[DESCARTADO] Un endpoint HTTP de importación** (`POST /series/importar`, solo administrador). Más superficie: subir archivos, límites de tamaño, tiempo de petición, una fila nueva en la matriz de roles, y un administrador cualquiera podría reemplazar el cuadro que la entidad validó. El cuadro se carga pocas veces y lo hace quien despliega, con acceso a la base. Contra: el evento de auditoría no tiene autor (ver 4). [PROPUESTA] Si algún día un administrador debe cargarlo desde la interfaz, el endpoint reutilizaría `importarCuadro` tal cual, con la simulación como paso previo y el autor en la auditoría.
- **[DESCARTADO] Importar en el arranque de la API** (desde un archivo o una variable). Es el mismo problema de migrar al arrancar, ya descartado en `docs/despliegue.md`, sección 13: varias instancias a la vez, arranque en frío más lento, y un cuadro que se reescribe con cada reinicio.
- **[DESCARTADO] Borrar lo ausente por defecto** (sincronizar el cuadro con el archivo). Un archivo incompleto, o el equivocado, borraría el cuadro. El borrado es una opción explícita y con la protección de los documentos.
- **[DESCARTADO] Aplicar parcialmente** (saltar las filas en conflicto y escribir el resto): dejaría un cuadro que nadie validó. También `--forzar` para saltarse los conflictos: la protección de los documentos no debe tener salida.
- **[DESCARTADO] Una librería de CSV.** Es una dependencia nueva para un formato de tres columnas, y lo que importa aquí (BOM, punto y coma, ANSI de Excel, mensajes con línea en español) lo tendría que cubrir igualmente el código propio.
- **[DESCARTADO] Adivinar la codificación** (reintentar como Windows-1252). Si acierta, nadie nota que adivinó; si falla, las tildes quedan mal en el cuadro. Un error claro con la instrucción es más seguro.
- **[DESCARTADO] Actualizar por identificador o por nombre.** El identificador es interno y el nombre es lo que cambia; el código es lo estable.
- **[DESCARTADO] Permitir mover subseries con documentos o cambiar de nivel un código existente.** Reclasificar documentos existentes es una decisión de archivo, no un efecto secundario de cargar un cuadro. [PROPUESTA] Si la entidad lo necesita, una función aparte, con auditoría por documento.
- **[DESCARTADO] `LOCK TABLE series_ccd`** en lugar del bloqueo de filas: bloquearía también las lecturas de otros usuarios mientras dure; el bloqueo de filas basta para frenar la carga de documentos.

## 4. Consecuencias y límites

- **El evento de auditoría no dice quién importó:** un comando no tiene sesión. Queda qué archivo (huella) y qué cambió, no quién. [PROPUESTA] Una opción `--usuario <nombre>` que exija un usuario activo existente; sería una afirmación sin verificar (quien tiene la `DATABASE_URL` puede decir cualquier nombre), así que no se agregó.
- **Cambiar un código es crear otro:** si la entidad recodifica una serie, el archivo trae el código nuevo y el viejo queda ausente (se conserva si tiene documentos). Los documentos no se reclasifican solos. [POR VERIFICAR] si el cuadro validado recodificará lo de la siembra.
- **Dos niveles:** el archivo con un tercer nivel se rechaza con un mensaje claro. [POR VERIFICAR] si el cuadro real de la entidad trae más niveles (dependencia, sección, subsección…): habría que cambiar el esquema y las reglas de la base antes de tocar este comando.
- **Valida el formato, no el contenido archivístico:** el comando no sabe si el cuadro es el correcto ni si respeta las TRD de la entidad. [PROPUESTA] Que la encargada del archivo valide el CSV antes de importarlo, y que la primera importación se haga con la simulación a la vista.
- **Códigos de [A-Za-z0-9] con `.` `-` `_` entre ellos** [PROPUESTA]: cubre `100.1`, `GC-01` o `2.1.3`. Si la entidad usa otro formato (con espacios o barras), se amplía la expresión en `cuadro.ts`.
- **Llegar al archivo en la nube** [POR VERIFICAR]: en Cloud Run el archivo debe estar dentro del contenedor. `docs/despliegue.md`, sección 9, propone montarlo como secreto (el cuadro no es secreto, pero Secret Manager sirve para entregar un archivo pequeño sin tocar la imagen) o ejecutar el comando desde un equipo con acceso a Neon. Ninguna de las dos se probó en la nube; sí se probó el comando contra PostgreSQL local, compilado y dentro de la imagen.
- **Esquema sin cambios:** no hay migración (la 0008 es de otro issue). La acción `ccd_importado` se documenta en `docs/modelo-de-datos.md`.

## 5. Cómo se verificó [CONFIRMADO]

- Unitarias del lector, la validación, el plan y los textos (`apps/api/src/ccd/importar/*.spec.ts`).
- De integración contra PostgreSQL real (`apps/api/test/ccd-importar.e2e-spec.ts`): importar el CSV de ejemplo, repetirlo (la base y la auditoría no cambian), renombrar una subserie con documentos, mover y eliminar con y sin documentos, `--eliminar-ausentes`, un archivo inválido que no escribe nada (la base queda idéntica), el todo o nada ante un fallo a mitad de la escritura, la espera a un documento que se está cargando y los textos y códigos de salida del comando.
- Mutaciones: quitar la protección de las subseries con documentos al mover, quitarla al eliminar y quitar el `FOR UPDATE` hacen fallar pruebas (3 grupos distintos); restauradas.

## 6. Referencias

- Issue #19; `docs/PLAN_EJECUCION.md`, sección 5 (#19); `docs/despliegue.md`, sección 9.
- `apps/api/src/ccd/importar/`, `docs/ejemplos/cuadro-ejemplo.csv`, `docs/modelo-de-datos.md`, sección 8.
