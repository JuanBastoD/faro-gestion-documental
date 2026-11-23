# ADR-011: Cambio y restablecimiento de clave: clave actual obligatoria, clave temporal del administrador y acceso restringido hasta cambiarla

- **Fecha:** 23 de noviembre de 2026
- **Estado:** Aceptada al fusionar este documento
- **Issue:** #51
- **Relacionada con:** ADR-003 (sesiones), ADR-008 (usuarios; este ADR cierra el hueco de su sección 4), ADR-009 (límite de intentos y verificación de origen), `docs/modelo-de-datos.md`, `docs/matriz-de-roles.md`
- **Etiquetas de certeza:** [CONFIRMADO] construido y probado en el repositorio (`apps/api/test/clave.e2e-spec.ts`, `auth.service.spec.ts`, `guardas.spec.ts`); [PROPUESTA] decidido por quien implementó, sin que el usuario lo haya revisado; [POR VERIFICAR] falta un dato o una prueba; [SUPUESTO] razonable pero sin medir; [DESCARTADO] considerado y rechazado.

## 1. Contexto

Hasta #17 la clave de cada persona la fijaba el administrador al crear la cuenta y ya nadie podía cambiarla (ADR-008, sección 4). Eso deja tres problemas reales para una entidad de 29 personas sin área de TI:

1. **Una clave que otra persona conoce no se puede reemplazar.** El administrador que crea la cuenta la sabe; quien la escribió en un papel o la mandó por WhatsApp la expuso. La única salida era desactivar la cuenta y crear otra con otro nombre.
2. **Quien olvida su clave no tiene camino.** No hay correo institucional en el alcance, así que no existe «recuperar por correo».
3. **No hay forma de cerrar una cuenta comprometida sin perderla.** Desactivar cierra las sesiones, pero también deja a la persona sin acceso.

Este ADR decide cómo se cambia y se restablece una clave sin abrir una puerta nueva a la fuerza bruta ni a quien robe una cookie de sesión.

## 2. Decisión

### 2.1 Cambio de la clave propia: `POST /auth/clave` [CONFIRMADO en #51]

Cualquier rol con sesión envía `{ claveActual, claveNueva }`. Responde **204** sin cuerpo.

- **Pide la clave actual aunque haya sesión.** Una cookie robada (o un computador de oficina desatendido) no debe bastar para quedarse con la cuenta. La clave actual se verifica con argon2id.
- **La clave nueva** tiene de 12 a 256 caracteres y no puede ser solo espacios: la misma validación que `POST /usuarios` (ADR-008), compartida en `apps/api/src/auth/datos-clave.ts`. Y debe ser **distinta de la actual**: dos textos iguales son la misma clave, así que se rechaza con 400 antes de verificar nada y sin delatar si la actual era correcta.
- **Los fallos cuentan en el límite de intentos del ingreso** (ADR-009). El intento se **reserva antes de verificar**, igual que en el ingreso, con el nombre de usuario de la persona y la IP. Sin esto, la ruta sería otra forma de adivinar la clave sin tope. Es el mismo contador: fallos de ingreso y fallos de cambio se suman, un bloqueo vale para los dos, y un cambio correcto reinicia la cuenta de esa persona. Con el límite agotado responde **429** con `Retry-After`, `codigo: demasiados_intentos` y, sin verificar la clave, el mensaje habla de «cambio de clave».
- **Clave actual incorrecta: 400 con `codigo: clave_actual_incorrecta`, nunca 401.** La interfaz entiende 401 como «la sesión venció» y sacaría a la persona de la aplicación por escribir mal una clave. No 403, para no confundirlo con el `cambio_de_clave_requerido` de la sección 2.3. [PROPUESTA] la elección entre 400 y otros códigos de error de cliente.
- **Cierra todas las demás sesiones de la persona y deja abierta la actual**, en la misma transacción que el cambio: o ocurren las dos cosas o ninguna. Quien cambia su clave porque sospecha de una sesión ajena queda protegido, y no tiene que volver a ingresar.
- **Dos cambios simultáneos con la misma clave actual no se pisan.** La escritura es `UPDATE ... WHERE clave_hash = <la verificada>`: si otra petición ya cambió la clave (otro cambio, o un restablecimiento del administrador entre la verificación y la escritura), no escribe nada y responde **409 `conflicto_de_clave`**, o 400 si la otra ya había terminado antes de verificar. Queda una sola clave nueva y no depende de quién escribió último. Probado con dos cambios en paralelo, tres veces.
- No se rota el token de la sesión actual: el servidor lo genera y es aleatorio de 256 bits, así que no hay fijación de sesión que corregir; cambiarlo obligaría a reescribir la cookie y a que la interfaz lo maneje, a cambio de nada medible. [PROPUESTA]

### 2.2 Restablecimiento por el administrador: `POST /usuarios/:id/clave` [CONFIRMADO en #51]

Solo el administrador (pasa por `OrigenGuard`, `AuthGuard` y `RolesGuard` como el resto de `/usuarios`). Envía `{ clave }` (12 a 256 caracteres) y responde **204** sin cuerpo: **la clave no vuelve a salir por la API.** El administrador se la entrega a la persona por otro medio.

En una transacción: guarda el hash de la clave nueva, pone `usuarios.debe_cambiar_clave = true`, **cierra todas las sesiones de esa persona** (reutiliza `borrarSesiones`, el mismo método que usa desactivar) y registra el evento.

Decisiones propias de esta ruta [PROPUESTA]:

- **Un administrador no restablece su propia clave por aquí: 409 `restablecer_clave_propia`.** Si alguien roba la cookie de un administrador, no debe poder fijarle una clave a esa cuenta sin conocer la actual; para su cuenta existe `POST /auth/clave`, que la exige. (Un administrador con la cookie robada sí puede restablecer la clave de *otras* personas: es inherente a ser administrador, y ya podría crear cuentas nuevas con cualquier rol.)
- **Un usuario inactivo sí se puede restablecer.** No tiene sesiones que cerrar, y permite preparar su reactivación (la clave temporal queda lista para cuando se reactive). No cambia quién puede ingresar: sigue inactivo.
- **Un administrador puede restablecer la clave de otro administrador**: es la salida de un administrador que olvida la suya mientras haya otro.
- Restablecer a quien ya tiene una clave temporal pisa la anterior.

### 2.3 Clave temporal: ver quién eres, cerrar sesión y cambiar la clave [CONFIRMADO en #51]

La clave que fija un administrador la conoce el administrador. Por eso la persona **debe cambiarla** antes de usar el sistema. `usuarios.debe_cambiar_clave` (migración 0008, `boolean not null default false`) lo marca; el cambio de clave propio lo apaga.

Mientras sea verdadera, `AuthGuard` (la guarda global de autenticación) responde **403 `cambio_de_clave_requerido`** a toda petición con sesión **salvo** las de los métodos marcados con `@PermitidoConClaveTemporal()`: `GET /auth/yo`, `POST /auth/logout` y `POST /auth/clave`.

- **La lista que se abre es corta y explícita; no hay lista de lo que se cierra.** Un endpoint nuevo queda cerrado para quien tiene una clave temporal sin que nadie tenga que acordarse. La marca se pone en cada método, nunca en la clase. No se compara el texto de las rutas.
- **Se evalúa antes que el rol**: un administrador con clave temporal tampoco administra ni consulta la auditoría. Por eso va en `AuthGuard` y no en `RolesGuard`.
- **El estado se lee de la base en cada petición**, como el rol (ADR-003): restablecer la clave rige en la siguiente petición. (De todos modos el restablecimiento cierra las sesiones de la persona.)
- **Cada denegación queda en la auditoría** como `acceso_denegado`, con el método, la ruta y el motivo (`GET /documentos; cambio de clave requerido`), sin lo que se enviara; si la auditoría falla, la respuesta sigue siendo 403.
- `GET /auth/yo` y el ingreso devuelven `usuario.debeCambiarClave` (campo nuevo y aditivo dentro de `usuario`), para que la interfaz lleve a la pantalla de cambio en cuanto la persona ingresa con la clave temporal. [PROPUESTA] ponerlo dentro de `usuario` (y no al lado) para que ingreso y `/auth/yo` tengan una sola forma.
- La clave temporal **no sirve como clave nueva** (distinta de la actual), y mientras se tiene la temporal, escribir mal la actual al cambiarla es un 400 como en cualquier cambio y cuenta en el límite.

### 2.4 Auditoría [CONFIRMADO en #51]

Dos acciones nuevas, sin tocar el resto:

- `clave_cambiada`: quien actúa es la misma persona; el detalle dice cuántas otras sesiones se cerraron (`otras sesiones cerradas: 2`) y, si se cambió desde una clave temporal, empieza por `desde clave temporal; ` (23 nov. 2026, ver §4, «Suplantación por quien fija la clave temporal»).
- `clave_restablecida`: quien actúa es el administrador; el detalle dice a quién y cuántas sesiones se cerraron (`usuario 7 (ana.perez); sesiones cerradas: 2`).

Además, el `ingreso` de una cuenta con la clave temporal pendiente lleva el detalle `con clave temporal` (sin él, un ingreso no lleva detalle). Son solo textos del campo `detalle` de acciones que ya existían: no hay acción, columna ni forma de respuesta nueva.

**Nunca** se guardan claves, hashes ni sus longitudes: una prueba busca ambas claves y el hash en toda la tabla de auditoría. Los dos eventos se escriben dentro de la transacción que hace el cambio.

Los **fallos de la clave actual** se registran con las acciones que ya existían para el ingreso, no con una nueva: `ingreso_fallido` con el detalle fijo `cambio de clave: clave actual incorrecta`, e `ingreso_bloqueado` en el intento que agota el límite (una sola vez, como en el ingreso). Es el mismo tipo de fallo, se cuenta en el mismo límite, y quien vigile los ingresos fallidos ve también a quien adivina una clave con una sesión robada. [PROPUESTA] Si se prefiere separarlos, es un cambio de una línea y una acción nueva en el catálogo.

### 2.5 Orden de los bloqueos [CONFIRMADO en #51]

`restablecerClave` bloquea **primero a todos los administradores activos y después la fila del usuario**, el mismo orden que `cambiar` (ADR-008, sección 2.2), y no debe cambiarse en uno solo de los dos. Bloquear solo la fila del usuario parece bastar y **no basta**: el evento de auditoría referencia al administrador que actúa por clave foránea, y esa inserción pide un bloqueo (`FOR KEY SHARE`) sobre la fila de ese administrador. Si un `cambiar` simultáneo ya la tiene bloqueada (`FOR UPDATE`) y espera la fila de este usuario, quedan esperándose uno al otro. Se **reprodujo** con una prueba determinista (dos conexiones y un paso intermedio, sin depender de un reloj): con el restablecimiento bloqueando solo al usuario, PostgreSQL responde `deadlock detected` (código `40P01`); con el orden de `cambiar`, termina en 204. La prueba falla si se quita el bloqueo de los administradores.

El cambio de clave propio (`POST /auth/clave`) bloquea una sola fila (la de la propia persona, con el `UPDATE`) y luego borra sus sesiones y audita sobre esa misma fila: no pide ninguna otra, así que no participa de ese ciclo. Una prueba lo comprueba con un administrador cambiando su clave mientras otro cambio tiene bloqueados a todos los administradores.

[POR VERIFICAR] Hay un `deadlock detected` intermitente, anterior a este trabajo, en la prueba «muchos cambios simultáneos sobre los administradores» de `usuarios.e2e-spec.ts` (se investiga en otra rama, `fix/usuarios-bloqueo-concurrente`). Este ADR no cambia el orden de bloqueos de `cambiar`; si esa corrección lo cambia, `restablecerClave` debe seguirlo, y la prueba de esta sección lo detectará si no.

## 3. Alternativas descartadas

- **[DESCARTADO] Restablecimiento por correo con un enlace o token.** No hay correo institucional en el alcance del proyecto ni servicio para enviarlo (y un token de restablecimiento es una credencial más que proteger y expirar). Con 29 personas conocidas, que el administrador fije una clave temporal y la entregue en persona es más simple y más fácil de auditar. Se reevalúa si la entidad adopta correo institucional.
- **[DESCARTADO] Preguntas secretas.** Se adivinan, se averiguan en redes sociales y no se pueden rotar; son una puerta trasera permanente a una cuenta con datos de contratación.
- **[DESCARTADO] Bloquear la cuenta hasta cambiar la clave, sin permitir ni siquiera ingresar.** La persona necesita una sesión para cambiarla (y la interfaz, saber quién es). Dejarla ingresar y cerrar todo lo demás da el mismo resultado sin una pantalla de «cuenta bloqueada» sin salida.
- **[DESCARTADO] Cambiar la clave sin pedir la actual si hay sesión.** Una cookie robada, o un computador desatendido, bastaría para quedarse con la cuenta de forma permanente.
- **[DESCARTADO] Devolver la clave temporal generada por el servidor.** Obliga a que la API entregue un secreto en una respuesta y a que alguien lo guarde en el navegador del administrador. Se prefiere que la fije el administrador y la API nunca la repita.
- **[DESCARTADO] Un `PATCH /usuarios/:id` con `clave`** (lo que proponía el ADR-008, sección 4). Mezcla un cambio de secreto con los de rol y actividad, que se auditan y se prueban de otra forma, y haría que el `PATCH` aceptara a veces un campo que hoy rechaza con 400.
- **[DESCARTADO] Lista de rutas prohibidas para quien tiene clave temporal.** Cada endpoint nuevo nacería abierto. Se invirtió: lo único permitido es lo marcado.
- **[DESCARTADO] Bloquear solo la fila del usuario en el restablecimiento** (más simple): provoca el interbloqueo reproducido en la sección 2.5.

## 4. Consecuencias y límites

- **El único administrador que olvida su clave no tiene salida por la API**: no puede restablecer la suya por `POST /usuarios/:id/clave` (a propósito) ni cambiarla sin la actual, y `crear-administrador` no toca una cuenta que ya existe. [POR VERIFICAR] hace falta una salida de emergencia con acceso a la base de datos o un comando para eso (`restablecer-clave`, parecido a `crear-administrador`). No se construyó: está fuera del alcance de #51.
- **El límite de intentos cuenta por nombre de usuario**: quien tenga una sesión robada y escriba claves erróneas puede bloquear, hasta 15 minutos, el ingreso de esa persona. No es una puerta nueva: ya lo podía hacer cualquiera con solo conocer el nombre de usuario, en `POST /auth/login` (ADR-009).
- **Una cookie robada de un administrador** puede fijar claves temporales a las demás cuentas. Es inherente al poder del administrador (ya puede crear cuentas con cualquier rol) y queda en la auditoría (`clave_restablecida`, con quién y a quién).
- **La clave temporal viaja por un canal que el administrador elige** (en persona, llamada): la API no la envía. Quien la recibe debe cambiarla al primer ingreso, y hasta entonces la API solo le deja hacer eso.
- **Suplantación por quien fija la clave temporal (H-01, revisión C3, 23 nov. 2026)** [CONFIRMADO leyendo el código; el escenario no se ejecutó antes del cambio]: el administrador que fija la clave temporal la conoce, así que puede ingresar con ella como esa persona y cambiarla usando la temporal como «clave actual»: queda dueño de la cuenta, y el `ingreso` y el `clave_cambiada` se atribuyen a la víctima. La auditoría no guarda IP, así que no hay forma de distinguir por origen. [CONFIRMADO en #57] Se deja un rastro con lo que ya existe: el `ingreso` de una cuenta con la clave temporal pendiente lleva el detalle `con clave temporal`, y `clave_cambiada` empieza por `desde clave temporal; ` cuando el cambio parte de una temporal. El rastro `clave_restablecida` (actor: el administrador) → `ingreso` `con clave temporal` (la persona) → `clave_cambiada` `desde clave temporal` (la persona) queda reconstruible y lo fija una prueba de extremo a extremo; si la persona dice «yo no fui», ese rastro, comparado con lo que ella hizo, es la pista. [CONFIRMADO] Esto **no impide** la suplantación, solo la deja visible: no se cambió ningún comportamiento (la API sigue aceptando la temporal igual). El ingreso con el detalle se marca por el estado de la cuenta, no por quién ingresa: si la propia persona ingresa con la temporal, también queda marcado, y es lo esperado. [PROPUESTA, no construido] Para cerrarla del todo: guardar IP y agente de usuario en `auditoria` (columna y migración nuevas), y/o una clave temporal de un solo uso que se cambie en el mismo acto de ingresar. [DESCARTADO por ahora] Impedir que el administrador cambie la clave de quien restableció: no es posible sin quitar el poder de restablecer.
- **La clave temporal no caduca (H-03, revisión C3, 23 nov. 2026)** [CONFIRMADO leyendo el código]: sirve hasta que la persona la cambie, sin límite de días. Si la persona no ingresa, la temporal sigue viva para quien la conozca (el administrador, o quien la vio en un chat). [PROPUESTA, no construido] Una columna `clave_temporal_vence_en` (por ejemplo, 72 horas desde el restablecimiento) que `ingresar` compare, rechazando con el mismo 401 genérico una temporal vencida, y que `POST /usuarios/:id/clave` vuelva a fijar. Necesita una **migración nueva** y cambia `POST /usuarios/:id/clave`, así que queda para una versión futura y no se hizo en esta noche (no se agregan migraciones ni columnas en #57 después de abierta). Mientras tanto, la mitigación es operativa: restablecer solo cuando la persona vaya a ingresar enseguida, y volver a restablecer (que pisa la temporal anterior) si pasa el plazo.
- **Carrera entre un ingreso y un cambio de clave (H-10, revisión C3, 23 nov. 2026)** [CONFIRMADO leyendo el código que no hay vínculo entre la sesión y la versión de la clave; el escenario temporal es un [SUPUESTO] que no se ejecutó]: un ingreso verifica la clave vieja antes de que otro cambio la reemplace, y crea su sesión después de que el cambio ya cerró las demás; esa sesión sobrevive al cambio. La ventana es la del cálculo de argon2 (unos cientos de milisegundos) y la aprovecharía quien ya conoce la clave vieja, que es justo de quien se quiere proteger la cuenta. [PROPUESTA, no construido] Atar la sesión a una huella de la clave (un contador o los últimos bytes del hash, guardados en `sesiones` al crearla) y descartar en `buscarVigente` las sesiones con otro valor. Necesita una **columna y migración nuevas** en `sesiones`, por eso queda para una versión futura. [DESCARTADO por ahora] Tomar un candado por usuario durante todo el ingreso: serializaría los ingresos de una misma persona y alargaría la espera de un hash lento para cubrir una ventana muy estrecha.
- **`@PermitidoConClaveTemporal()` solo en métodos (I-03, revisión C3, 23 nov. 2026)** [CONFIRMADO en #57]: `AuthGuard` lee el decorador del método y de la clase; en una clase abriría todas sus rutas a quien tiene clave temporal. El comentario del decorador ya lo prohibía y ahora lo exige una prueba (`apps/api/test/clave-temporal-rutas.e2e-spec.ts`) que recorre los controladores reales con los metadatos de Nest: falla si el decorador está en una clase, fija la lista exacta de las tres rutas permitidas (`GET /auth/yo`, `POST /auth/logout`, `POST /auth/clave`) y comprueba que toda otra ruta con sesión responde 403 `cambio_de_clave_requerido`. Ampliar la lista es una decisión que se toma cambiando esa prueba y este ADR.
- **Sin caducidad periódica de claves ni historial de claves anteriores** [PROPUESTA, no construido]: una persona puede volver a una clave que ya usó antes (menos la actual).
- **`GET /usuarios` no muestra quién tiene una clave temporal pendiente** [PROPUESTA, no construido]: se dejó fuera para no cambiar la forma de esa respuesta en este issue; la interfaz de administración podría necesitarlo.
- **Los usuarios nuevos no nacen con cambio obligatorio y `crear-administrador` no lo exige** [PROPUESTA, no construido]: quien crea una cuenta conoce la clave inicial. Cambiar eso alteraría `POST /usuarios` y la siembra, que este issue no toca. Quien quiera ese comportamiento puede restablecer la clave justo después de crear la cuenta.
- **Los datos de la siembra no cambian**: `db:seed` sigue creando usuarios con `debe_cambiar_clave = false` y la clave de `SEMILLA_CLAVE`.
- **Interfaz** [POR VERIFICAR]: este issue es solo de la API. Las pantallas (cambio de clave, y el aviso al ingresar con clave temporal) las implementa quien haga la interfaz, con el contrato que dejó el issue (README, sección «Claves»).

## 5. Referencias

- Issue #51 (cambio y restablecimiento de clave); ADR-008, sección 4 (el hueco que cierra); ADR-009 (límite de intentos y verificación de origen).
- Código: `apps/api/src/auth/auth.service.ts` (`cambiarClave`), `auth.guard.ts` (clave temporal), `datos-clave.ts`, `apps/api/src/usuarios/usuarios.service.ts` (`restablecerClave`), migración `0008_cambio_de_clave`.
- Pruebas: `apps/api/test/clave.e2e-spec.ts` (68 casos de integración), `auth.service.spec.ts` y `guardas.spec.ts` (unitarias), `matriz-de-roles.e2e-spec.ts` y `modelo-de-datos.e2e-spec.ts` (documentos al día).
