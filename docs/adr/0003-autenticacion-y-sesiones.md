# ADR-003: Autenticación con sesiones en el servidor y base de datos de pruebas aparte

- **Fecha:** 22 de noviembre de 2026
- **Estado:** Aceptada al fusionar este documento
- **Issue:** #8
- **Relacionada con:** ADR-001 (su sección 5 deja abiertos el mecanismo de autenticación y la base de pruebas), ADR-002 (módulos `auth` y `auditoria`)
- **Etiquetas de certeza:** [CONFIRMADO] construido y verificado en el repositorio; [PROPUESTA] decidido pero aún no construido; [POR VERIFICAR] falta un dato o una prueba.

## 1. Contexto

El prototipo v1 guardaba las sesiones en la memoria del proceso: se perdían al reiniciar y no servían con más de una instancia. El issue #8 pide una sesión que **sobreviva a reinicios y a varias instancias**, contraseñas con argon2 y guardas por rol en el servidor.

Además, el sistema debe poder **desactivar a una persona** (#17) y que eso surta efecto de inmediato, y el repositorio es público, así que no puede haber secretos ni claves fijas en el código.

## 2. Decisión

### 2.1 Sesiones en el servidor, guardadas en PostgreSQL [CONFIRMADO en #8]

- Al ingresar se genera un token aleatorio de 32 bytes (`crypto.randomBytes`) que viaja en la cookie `faro_sesion` (`HttpOnly`, `SameSite=Lax`, `Secure` en producción).
- En la tabla `sesiones` se guarda **solo el SHA-256 del token**. Quien lea la base no puede usar las sesiones. Un SHA-256 simple basta porque el token ya es aleatorio y de 256 bits; no es una contraseña elegida por una persona.
- Una sesión **vence a las 8 horas sin uso** (se renueva al usarla, como mucho una vez por minuto para no escribir en cada petición) y **a los 7 días aunque se use sin parar**.
- Cada consulta de sesión comprueba también que el usuario siga activo: **desactivar a alguien invalida sus sesiones al instante**, sin lista de revocación.
- Cerrar sesión borra la fila.

### 2.2 Claves con argon2id [CONFIRMADO en #8]

Paquete `argon2` con los parámetros por defecto de la librería (argon2id, 64 MiB, 3 pasadas). Si el usuario no existe se verifica igual contra un hash de relleno, para que el tiempo de respuesta no revele qué usuarios existen. El mensaje de error es el mismo para usuario inexistente, usuario inactivo y clave errónea.

### 2.3 Guardas globales [CONFIRMADO en #8]

Dos guardas globales (`APP_GUARD`), en este orden:

1. `AuthGuard`: **todo exige sesión** salvo lo marcado `@Publico()` (hoy `/health` y `POST /auth/login`). Lo seguro es el valor por defecto: una ruta nueva olvidada queda protegida.
2. `RolesGuard`: si la ruta declara `@Roles(...)` y la persona no tiene uno de esos roles, responde 403 y registra un evento `acceso_denegado` con quién, qué ruta y qué rol hacía falta. Si la auditoría falla, el acceso sigue denegado.

Una ruta con `@Roles` sin sesión responde 401, no 403.

### 2.4 Auditoría desde el primer día [CONFIRMADO en #8]

`AuditoriaService.registrar()` nace en #8 (ingreso, ingreso fallido, cierre de sesión y acceso denegado), y acepta una transacción como parámetro opcional para que las funciones siguientes guarden su cambio y su evento juntos. #14 completa la consulta y la inmutabilidad. En el ingreso fallido **no se guarda el nombre escrito**, porque a veces la gente escribe su clave en ese campo; basta con saber si el usuario existía.

### 2.5 Base de datos de pruebas aparte [CONFIRMADO en #8]

Las pruebas de integración usan una base propia: la de `DATABASE_URL` con `_test` añadido (`faro` → `faro_test`), o `DATABASE_URL_TEST` si se define. Se crea sola, se migra antes de las pruebas y se vacía entre una prueba y otra. El nombre debe terminar en `_test` o las pruebas se niegan a correr, porque vacían tablas.

## 3. Alternativas descartadas

| Alternativa | Motivo del descarte |
|---|---|
| **JWT** (en cookie o en cabecera) | No se puede revocar antes de que venza sin guardar una lista de revocación, que es guardar estado en el servidor de todos modos. Desactivar a una persona (#17) no surtiría efecto inmediato. |
| **Sesión en la memoria del proceso** (el prototipo) | Es justo el problema que el issue pide resolver. |
| **Redis para las sesiones** | Un servicio más que operar y desplegar para 29 personas. PostgreSQL ya está y la consulta de sesión es por clave primaria. |
| **`express-session` con un almacén en PostgreSQL** | Agrega dos dependencias para lo que son unas 80 líneas propias y probadas, y oculta la regla de "usuario inactivo" dentro de la librería. |
| **bcrypt** | Válido, pero argon2id es la recomendación actual de OWASP para contraseñas y el paquete instala sin compilar en Windows y en el CI de Linux (comprobado). |
| **Guardar el token tal cual** | Una filtración de la base entregaría sesiones activas. |

## 4. Consecuencias

**A favor**

- Reiniciar o escalar la API no cierra sesiones. Está probado con una segunda instancia sobre la misma base.
- Desactivar un usuario o cerrar una sesión es inmediato.
- Una ruta nueva nace protegida.

**En contra y riesgos**

- **Cada petición autenticada consulta la base** (una consulta por clave primaria con una unión a `usuarios`). A este volumen es despreciable [SUPUESTO: no se midió]; si hiciera falta se puede poner una caché corta en memoria, a costa de que la desactivación tarde esos segundos.
- **Las sesiones vencidas se limpian solo al ingresar** esa misma persona. Las de quien no vuelve quedan en la tabla. [PENDIENTE] una limpieza programada o un `delete` periódico; no afecta la seguridad porque una sesión vencida no sirve.
- **Sin protección contra fuerza bruta ni CSRF todavía.** Llegan en #18. Mientras tanto la cookie `SameSite=Lax` cubre la mayor parte del CSRF en navegadores actuales, pero no es una defensa completa [POR VERIFICAR en #18].
- **argon2 es un paquete con binarios nativos.** Instala sin compilar con los binarios precompilados que trae; si en algún entorno no hubiera binario para la plataforma, habría que compilarlo o usar `@node-rs/argon2`. En el CI de Linux se comprueba en cada ejecución.
- **Roles fijos en el código** (`administrador`, `editor`, `consulta`). Cambiar o agregar roles exige una migración del tipo enumerado.
- **La cookie lleva el nombre `faro_sesion`.** En producción convendría el prefijo `__Host-`, que obliga a `Secure` y a la ruta raíz [PROPUESTA para #18 o #20].

## 5. Referencias

- `docs/PLAN_EJECUCION.md`, sección 5 (#8 y #14) y decisión 14.
- `apps/api/src/auth/`, `apps/api/src/auditoria/`, `apps/api/test/auth.e2e-spec.ts`.
- OWASP Password Storage Cheat Sheet y Session Management Cheat Sheet (criterio general, no se citan versiones).
