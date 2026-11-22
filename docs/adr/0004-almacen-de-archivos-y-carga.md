# ADR-004: Almacén de archivos y carga sin estados a medias

- **Fecha:** 22 de noviembre de 2026
- **Estado:** Aceptada al fusionar este documento
- **Issue:** #10
- **Relacionada con:** ADR-002 (deja abierto cómo se coordinan la base y el almacén, y promete confirmarlo al implementar #10), ADR-001 (S3 compatible, RustFS en local)
- **Etiquetas de certeza:** [CONFIRMADO] construido y verificado en el repositorio; [PROPUESTA] decidido pero aún no construido; [POR VERIFICAR] falta un dato o una prueba.

## 1. Contexto

Un documento cargado toca dos sistemas que **no comparten transacción**: la base de datos (documento, versión, auditoría) y el almacén de archivos (el PDF). Si algo falla entre los dos pasos puede quedar un registro sin archivo (el peor caso: una descarga que no encuentra nada) o un archivo sin registro (basura que ocupa espacio). El criterio de aceptación del issue es que **no quede ninguno de los dos**.

Además el almacén debe poder cambiar (una carpeta en desarrollo, RustFS en local, Cloud Storage en la nube) sin tocar las reglas de negocio.

## 2. Decisión

### 2.1 Puerto `AlmacenArchivos` con dos adaptadores [CONFIRMADO en #10]

Interfaz con `guardar`, `leer`, `existe`, `borrar` y `listar`. Adaptadores: `AlmacenDisco` (una carpeta; para desarrollo y pruebas sin Docker) y `AlmacenS3` (`@aws-sdk/client-s3` con `forcePathStyle`, que sirve para RustFS y para Cloud Storage en modo interoperable). Se elige con `ALMACEN_TIPO` (`disco` por defecto) y, con `s3`, la API no arranca si falta alguna variable `S3_*`. Las mismas pruebas de contrato corren contra los dos adaptadores.

El cliente S3 se configura con `requestChecksumCalculation: 'WHEN_REQUIRED'`: las sumas de verificación automáticas de las versiones recientes del SDK no las aceptan todos los almacenes compatibles [POR VERIFICAR contra Cloud Storage en #20].

### 2.2 Claves por huella [CONFIRMADO en #10]

La clave del objeto es `documentos/<sha256>.pdf`. Solo depende del contenido, así que guardar el mismo archivo dos veces escribe lo mismo en el mismo sitio, y un reintento tras un fallo es inocuo. Las claves las genera el sistema y se validan con un formato estricto (minúsculas, dígitos, `_ - . /`, sin `..`, sin segmentos vacíos ni ocultos) en los dos adaptadores y en el de disco además se comprueba que la ruta final quede dentro de la carpeta raíz.

### 2.3 Orden de la carga [CONFIRMADO en #10]

1. Validar datos, que el archivo sea un PDF (por su firma `%PDF-`, no por extensión ni tipo MIME) y que la serie sea una subserie. El límite de 20 MB lo corta multer mientras lee.
2. Calcular el SHA-256 y **guardar el objeto**.
3. En **una sola transacción**: insertar documento, versión 1 y el evento de auditoría `carga`.
4. Si la transacción falla: **borrar el objeto solo si ninguna versión lo referencia** (otro documento puede haber cargado el mismo archivo). Si el borrado falla, se registra en el log y el objeto queda como huérfano, sin tapar el error original.

### 2.4 Huérfanos [CONFIRMADO en #10]

Si el proceso muere entre los pasos 2 y 3 queda un objeto sin fila. `npm run almacen:huerfanos -w apps/api` lista los objetos que ninguna versión usa y, con `-- --borrar`, borra los de más de una hora (la antigüedad mínima evita tocar una carga en curso).

### 2.5 La auditoría comparte la transacción [CONFIRMADO en #10]

`AuditoriaService.registrar(evento, tx)` recibe la transacción del llamador, así que el cambio y su evento se confirman o se deshacen juntos. Esto resuelve el punto "transacciones entre módulos" que el ADR-002 dejaba [POR VERIFICAR]: se pasa la transacción como parámetro y no hace falta un mecanismo más elaborado.

## 3. Alternativas descartadas

| Alternativa | Motivo del descarte |
|---|---|
| **Insertar la fila primero y subir el archivo después** | Un fallo al subir deja un registro sin archivo: es el estado peor, porque el usuario lo ve y la descarga falla. Es preferible un objeto huérfano, que nadie ve. |
| **Transacción distribuida o patrón de dos fases** | Desproporcionado para un almacén que ni siquiera la ofrece. La clave por huella hace seguro el reintento y los huérfanos se limpian aparte. |
| **Clave aleatoria (UUID) por carga** | Cada reintento o carga repetida dejaría un objeto nuevo. Con la huella el mismo contenido ocupa un solo lugar. |
| **Guardar los PDF en la base (bytea)** | Infla la base y las copias de seguridad; PostgreSQL gestionado en la nube tiene límites de tamaño más estrictos que un bucket. |
| **Disco local en producción** | Se pierde al redesplegar un contenedor (ADR-001). |
| **Validar el PDF por la extensión o el tipo MIME** | Los declara el cliente: cualquiera puede mandar texto con extensión `.pdf`. |
| **Subida directa al almacén con URL firmada** | Mejor para archivos grandes, pero obliga a validar después de subir. Con 20 MB como máximo, pasar por la API simplifica el control. |

## 4. Consecuencias

**A favor**

- Sin estado a medias en los casos de fallo que se pueden provocar (probados: falla la transacción con y sin otro documento que use el archivo).
- Cambiar de almacén es configuración. Los PDF se pueden verificar contra su huella con solo leer el objeto.

**En contra y riesgos**

- **Una carrera en la compensación:** si dos cargas del mismo contenido ocurren a la vez y la primera falla justo antes de que la segunda inserte su versión, la primera borra el objeto que la segunda necesita. La ventana es de milisegundos y exige dos cargas idénticas simultáneas con una falla. No se mitigó [POR VERIFICAR si hace falta: se resolvería con un bloqueo consultivo por huella].
- **Un huérfano por muerte del proceso** se acumula hasta que alguien ejecute el script. No hay una limpieza programada [PENDIENTE; #21 puede incluirla].
- **Los 20 MB se leen completos en memoria** (multer sin disco). Con pocas cargas concurrentes es aceptable; si crecieran, habría que pasar a streaming.
- **Dos documentos distintos con el mismo archivo comparten el objeto.** Borrar un objeto exige comprobar las referencias (lo hace la compensación); no hay hoy una operación de borrado de documentos.
- **El aviso de duplicado llegó en #12 (ADR-006).** Desde entonces un archivo idéntico a uno existente se rechaza con 409 y uno muy parecido pide una decisión.
- El nombre original del archivo se limpia (sin carpetas ni caracteres de control, 150 caracteres como máximo) pero se conserva con sus tildes.

## 5. Referencias

- `docs/PLAN_EJECUCION.md`, sección 5 (#10).
- `apps/api/src/almacen/`, `apps/api/src/documentos/`, `apps/api/test/almacen.e2e-spec.ts`, `apps/api/test/documentos.e2e-spec.ts`.
