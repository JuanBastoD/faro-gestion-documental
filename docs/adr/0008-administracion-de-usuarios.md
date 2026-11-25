# ADR-008: Administración de usuarios: desactivar en vez de borrar y protección del último administrador

- **Fecha:** 22 de noviembre de 2026
- **Estado:** Aceptada al fusionar este documento
- **Issue:** #17 (HU-06)
- **Relacionada con:** ADR-003 (sesiones y roles), ADR-005 (la trazabilidad de versiones), `docs/modelo-de-datos.md`
- **Etiquetas de certeza:** [CONFIRMADO] construido y verificado en el repositorio; [PROPUESTA] decidido pero aún no construido; [POR VERIFICAR] falta un dato o una prueba.

## 1. Contexto

El administrador debe poder crear usuarios, cambiarles el rol y desactivarlos. Cada documento, versión y evento de auditoría apunta a quien lo hizo: si un usuario desapareciera, se perdería la evidencia de quién cargó qué ante un ente de control. Y un sistema sin administradores activos no tiene arreglo por la API: nadie puede crear a otro.

## 2. Decisión

### 2.1 Nunca se borra a nadie; desactivar cierra las sesiones [CONFIRMADO en #17]

`PATCH /usuarios/:id` cambia `rol` y `activo`; no existe `DELETE`. Al desactivar, **en la misma transacción** se borran las sesiones del usuario y se audita cuántas había: la sesión abierta deja de servir en la siguiente petición (ya dejaba de servir porque la consulta de sesión exige `activo`, pero así no quedan filas vivas). Un usuario inactivo no ingresa y el intento queda como `ingreso_fallido` con el detalle `usuario inactivo`. El cambio de rol rige al instante, incluso con la sesión abierta, porque el rol se lee de la base en cada petición (ADR-003). Cambiar un valor por el que ya tiene responde 200 y no deja evento.

### 2.2 El último administrador activo no puede dejar de serlo [CONFIRMADO en #17]

Desactivar o degradar a quien sea el único administrador activo responde **409 `ultimo_administrador`**. Un administrador sí puede desactivarse o degradarse a sí mismo **si queda otro activo**; uno inactivo no cuenta.

La comprobación «¿queda otro?» no basta sola: dos administradores que se degradan a la vez verían cada uno al otro y ambos pasarían, dejando cero. Por eso, dentro de la transacción de cada cambio, **primero se bloquean (`SELECT ... FOR UPDATE`) todos los administradores activos y después la fila del usuario**, siempre en ese orden (así no hay interbloqueos). El segundo cambio espera, vuelve a evaluar con lo que dejó el primero y encuentra que él es el último. Probado con dos administradores que se degradan mutuamente en paralelo, cinco veces (siempre 200 y 409, siempre queda uno); la prueba falla si se quita el bloqueo.

### 2.3 Nombre de usuario en minúsculas, clave de al menos 12 caracteres [CONFIRMADO en #17]

El ingreso compara el nombre tal cual, así que `usuario` se limita a `[a-z0-9][a-z0-9._-]{2,63}`: «Ana» y «ana» no pueden ser dos cuentas ni confundirse, y no se normaliza en silencio (lo que se escribe es lo que queda; si no cumple, 400 con el motivo). La clave tiene entre 12 y 256 caracteres y no puede ser solo espacios (el máximo evita cuerpos enormes que hagan trabajar al hash). Se guarda con argon2id; ni la respuesta, ni el error, ni la auditoría la repiten. [SUPUESTO] 12 es una barrera razonable para cuentas creadas por un administrador; no es una política de la entidad.

### 2.4 Auditoría [CONFIRMADO en #17]

Cuatro acciones nuevas: `usuario_creado`, `usuario_rol_cambiado` (con el rol anterior y el nuevo), `usuario_desactivado` (con las sesiones cerradas) y `usuario_reactivado`. Quien actúa es el administrador; el afectado va en el detalle como `usuario <id> (<nombre de usuario>)`. Cambiar rol y actividad en la misma petición registra un evento por cada cambio, todos dentro de la misma transacción que el cambio.

## 3. Alternativas descartadas

- **Borrar usuarios** (con o sin borrado en cascada): pierde la evidencia de autoría. Las claves foráneas de `documentos`, `versiones` y `auditoria` además lo impiden.
- **Comprobar «¿queda otro administrador?» sin bloqueo** o con un `CHECK`/disparador en la base: sin bloqueo hay carrera (probado); un disparador no ve las demás filas de forma consistente bajo concurrencia sin bloquearlas igual, y esconde la regla. Un nivel de aislamiento `SERIALIZABLE` habría servido, pero obliga a reintentar transacciones; el bloqueo explícito es más simple y predecible.
- **Normalizar el nombre de usuario a minúsculas al crear:** el que crea «Ana» y luego ve que ingresa con «ana» se sorprende; rechazar con un mensaje claro es más honesto.
- **Impedir que un administrador se desactive a sí mismo:** innecesario si queda otro, y estorba el traspaso de funciones.

## 4. Consecuencias y límites

- **Nadie puede cambiar su clave, y un administrador tampoco puede restablecer la de otro.** Hoy la clave la fija el administrador al crear la cuenta y queda así. Es un hueco real que este issue no pedía cerrar (sus criterios son crear, desactivar y cambiar el rol): [PROPUESTA] un `PATCH /usuarios/:id` con `clave` (restablecer, cierra las sesiones del usuario) y un cambio de clave propio con la clave actual. Mientras no exista, una clave comprometida se resuelve desactivando la cuenta y creando otra con otro nombre.
- **No se puede editar el nombre ni el nombre de usuario** después de crear (el `PATCH` rechaza esos campos con 400).
- **El listado no se pagina:** son unas decenas de usuarios. Si crecen, se agrega paginación sin cambiar la forma de cada elemento.
- **Sin límite de intentos de ingreso todavía:** llega con #18.
- **Esquema sin cambios:** no hay migración nueva; las acciones nuevas son valores de `auditoria.accion` (texto), y se documentan en `docs/modelo-de-datos.md`, sección 8.

## 5. Nota del 23 de noviembre de 2026: el orden de los bloqueos no basta, se agrega un candado consultivo

Lo decidido en 2.2 no cambia: antes de contar quién queda, cada cambio bloquea a los administradores activos y después al usuario. Lo que sí resultó falso es la frase «siempre en ese orden, así no hay interbloqueos». [CONFIRMADO] El CI del PR #56 (run 45113302506, intento 1) registró dos `deadlock detected` (40P01, respuesta 500) en la prueba «muchos cambios simultáneos sobre los administradores…», y la misma prueba falló en la primera ejecución local, antes de la corrección. Dos cosas que el orden por sí solo no cubre:

1. En READ COMMITTED, una consulta `SELECT ... FOR UPDATE` que esperaba una fila y la encuentra cambiada por otra transacción bloquea la versión nueva y recién entonces comprueba el filtro: si ya no cumple, la descarta del resultado, pero **el bloqueo queda puesto hasta el final de la transacción**.
2. El evento de auditoría referencia por clave foránea a quien actúa, y esa inserción pide un `FOR KEY SHARE` sobre la fila de esa persona **al final** de la transacción. Si quien actúa ya fue degradado por otro cambio confirmado, no está entre los administradores bloqueados al principio, así que esa fila se pide fuera de orden.

El ciclo, tal como lo dejó PostgreSQL: la transacción que desactiva al usuario 4 (con el usuario 1 como actor, ya degradado) tiene la fila 4 y espera la fila 1 para auditar; otra transacción, que esperó la degradación del usuario 1 y la dejó bloqueada aunque la descartó, espera la fila 4. Se replicó a mano con SQL: con `FOR UPDATE`, 40P01; con `FOR NO KEY UPDATE`, ese ciclo concreto desaparece. [CONFIRMADO] Pero cambiar solo el modo de bloqueo no basta: en la prueba de estrés, con veinte cambios simultáneos entre cuatro administradores (degradaciones mezcladas con ascensos y reactivaciones), siguieron los 40P01 entre las propias consultas de administradores, porque el usuario objetivo se bloquea después y fuera de orden respecto de otras transacciones.

**Decisión:** `bloquearAdministradoresActivos` toma primero un candado consultivo de transacción (`pg_advisory_xact_lock`) y solo después bloquea las filas. Los cambios de rol y estado quedan en fila uno tras otro; son raros, así que la serialización total no cuesta nada visible. Todo código que cambie rol o estado de usuarios debe llamar a ese método antes de bloquear nada más. Además, [PROPUESTA] `enTransaccion` del repositorio de administración repite la transacción entera (máximo 3 intentos) si PostgreSQL la aborta con 40P01 o 40001: es seguro porque el trabajo solo toca la base y la transacción abortada no deja nada; si aparece otro cruce que hoy no se conoce, la persona no ve un 500.

**Alternativas descartadas:** (a) *solo* `FOR NO KEY UPDATE`: medido, no alcanza (arriba). (b) Bloquear la fila de quien actúa al principio, junto con las demás: obliga a unir a un conjunto de filas con un orden global por id y a reconstruirlo en cada rama (actor degradado, objetivo fuera del conjunto); más frágil que un solo candado. (c) `SERIALIZABLE`: ya descartado en la sección 3 por obligar a reintentar toda la lógica; aquí el reintento queda acotado al abrazo mortal. (d) Reintento *sin* candado: medido, deja pasar errores (la prueba de estrés falla igual con el reintento puesto y el candado quitado).

**Qué prueba esto:** `apps/api/test/usuarios-concurrencia.e2e-spec.ts` (rondas de cambios cruzados con vigilante de «nunca cero administradores» y un abrazo mortal fabricado que debe repetirse solo) y `apps/api/src/usuarios/usuarios-admin.repository.spec.ts` (el reintento). [CONFIRMADO] Con el código anterior, la prueba de estrés falla en la primera ronda; sin el candado, vuelve a fallar.
