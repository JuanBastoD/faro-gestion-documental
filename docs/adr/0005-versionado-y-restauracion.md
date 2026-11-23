# ADR-005: Versionado de documentos y restauración que solo agrega

- **Fecha:** 22 de noviembre de 2026
- **Estado:** Aceptada al fusionar este documento
- **Issue:** #11
- **Relacionada con:** ADR-004 (carga: el objeto se guarda primero y el registro después), ADR-003 (auditoría), alcance del proyecto («control de versiones para trazabilidad ante entes de control»)
- **Etiquetas de certeza:** [CONFIRMADO] construido y verificado en el repositorio; [PROPUESTA] decidido pero aún no construido; [POR VERIFICAR] falta un dato o una prueba.

## 1. Contexto

El control de versiones existe para que un ente de control pueda reconstruir qué decía un documento en cada momento y quién lo cambió. Eso exige un historial que **solo crece**: si restaurar una versión editara o borrara filas, el historial dejaría de servir de evidencia.

Dos reglas del modelo de datos inicial chocaban con restaurar:

- La huella SHA-256 era única por documento. Restaurar la versión 1 crea una versión nueva con el mismo contenido que la 1, así que la restricción lo habría impedido.
- La numeración (`vigente + 1`) falla si dos personas versionan el mismo documento a la vez: las dos leen el mismo número y una de las dos choca o, peor, se pisan.

## 2. Decisión

### 2.1 Restaurar es crear una versión nueva [CONFIRMADO en #11]

`POST /documentos/:id/versiones/:n/restaurar` inserta la versión `vigente + 1` con el contenido de la `n` y la marca con `restaurada_de = n`. Las filas anteriores no se tocan. El objeto del almacén no se copia: la versión nueva apunta a la misma clave (`documentos/<sha256>.pdf`), que ya es por contenido (ADR-004). Una prueba compara el historial antes y después y comprueba que el almacén no ganó ningún objeto.

El motivo es opcional al restaurar (por defecto «Restaura la versión n»); al subir una versión nueva es **obligatorio** (1 a 300 caracteres) porque es lo que explica el cambio ante un auditor.

### 2.2 La huella es única por documento solo entre versiones con contenido nuevo [CONFIRMADO en #11]

El índice único `versiones_documento_sha256_uq` pasó a ser **parcial**: `(documento_id, sha256) WHERE restaurada_de IS NULL`. Así subir de nuevo un archivo idéntico a una versión que ya tiene el documento se rechaza con 409 y se dice cuál es, pero una restauración puede repetir la huella a propósito. La huella **no** es única entre documentos distintos: el mismo PDF puede estar en dos expedientes (la verificación entre documentos es la de la carga, ADR-006).

Dos restricciones más protegen el campo nuevo, ya en la base y no solo en el servicio:

- Clave foránea compuesta `(documento_id, restaurada_de) → (documento_id, numero)`: se restaura una versión que existe **en el mismo documento**.
- `CHECK (restaurada_de IS NULL OR restaurada_de < numero)`: la versión restaurada es anterior.

### 2.3 Numeración con bloqueo de la fila del documento [CONFIRMADO en #11]

Subir y restaurar abren una transacción que primero hace `SELECT ... FOR UPDATE` sobre el documento. Dos versiones simultáneas se ponen en fila: la segunda espera, lee el número ya actualizado y toma el siguiente. Pruebas con peticiones simultáneas reales: dos versiones distintas reciben el 2 y el 3; el mismo contenido enviado dos veces a la vez da un 201 y un 409; dos restauraciones iguales a la vez dan un 201 y un 409.

El 409 de la segunda llega por la comprobación bajo bloqueo; la restricción única de la base queda como red de seguridad (si salta, se traduce al mismo 409).

### 2.4 Cada operación deja un evento de auditoría en la misma transacción [CONFIRMADO en #11]

Eventos `version` y `restauracion` (catálogo de ADR-003). Si el evento no se puede escribir, la versión tampoco se crea.

### 2.5 Orden de la subida igual al de la carga [CONFIRMADO en #11]

Se valida todo lo barato antes de tocar el almacén (motivo, que sea PDF, que el documento exista), después se guarda el objeto y después la transacción. Si la transacción falla se borra el objeto salvo que otra versión ya lo use (misma compensación que ADR-004, ahora compartida en `compensarObjeto`). Restaurar no sube nada, pero antes de crear la versión comprueba que el objeto de origen siga en el almacén; si se perdió responde 404 con un mensaje claro y no crea nada.

## 3. Alternativas descartadas

- **Restaurar editando la versión vigente (o copiando su contenido encima):** destruye evidencia. Descartada.
- **Quitar la restricción de huella única por documento:** permitiría subir dos veces lo mismo por error sin aviso. El índice parcial conserva la protección y permite restaurar.
- **Guardar una copia del archivo al restaurar:** duplica espacio sin ganar nada, porque los objetos ya se identifican por contenido.
- **Resolver la numeración con un reintento al chocar con la restricción única:** funciona pero devuelve errores raros bajo concurrencia y complica los mensajes. El bloqueo de la fila es más simple y da respuestas predecibles.
- **Una secuencia de la base por documento para el número:** una secuencia deja huecos al fallar una transacción; el historial sin huecos es más fácil de explicar a un auditor.

## 4. Consecuencias y límites

- **Se puede restaurar una restauración** y volver a una versión que ya se restauró antes; el historial solo crece.
- **No se permite restaurar si el contenido de la vigente ya es el pedido** (409): crearía una versión idéntica a la actual sin aportar nada.
- **No hay borrado ni edición de versiones**, por diseño. Si una versión se subió por error, se corrige con una versión nueva (o con una restauración) y el error queda en el historial.
- El bloqueo es por documento: versionar documentos distintos no se bloquea entre sí. [POR VERIFICAR] su coste con muchas versiones simultáneas del mismo documento; con 29 usuarios no es un riesgo previsible.
- El tamaño de cada versión sigue limitado a 20 MB y se lee completo en memoria (ADR-004).
- **Migración 0004:** quita la restricción única de la huella, agrega `restaurada_de`, la clave foránea compuesta, el índice parcial y el `CHECK`. Las filas existentes quedan con `restaurada_de` nulo, que es lo correcto: todas son versiones con contenido nuevo. En un entorno ya desplegado se aplica con `npm run db:migrate -w apps/api` **antes** de arrancar la versión nueva de la API.
