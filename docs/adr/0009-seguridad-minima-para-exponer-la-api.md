# ADR-009: Seguridad mínima para exponer la API: CSRF por origen, límite de intentos de ingreso, cabeceras y secretos

- **Fecha:** 22 de noviembre de 2026
- **Estado:** Aceptada al fusionar este documento
- **Issue:** #18
- **Relacionada con:** ADR-003 (sesiones y cookie), ADR-008 (usuarios), `docs/modelo-de-datos.md`, `docs/despliegue.md`
- **Etiquetas de certeza:** [CONFIRMADO] construido y probado en el repositorio; [PROPUESTA] decidido pero aún no construido; [POR VERIFICAR] falta un dato o una prueba; [SUPUESTO] razonable pero sin medir.

## 1. Contexto

La API va a quedar en internet (Cloud Run, #20) con datos ficticios pero con usuarios, sesiones y documentos. Hasta #17 había tres huecos obvios:

1. **Nada limitaba los intentos de ingreso.** Con 29 personas en la entidad y claves elegidas por ellas, la fuerza bruta contra `POST /auth/login` es el ataque más barato.
2. **Una página de otro sitio podía hacer que el navegador de una persona con sesión enviara una petición que modifica datos** (CSRF). La cookie ya es `HttpOnly` y `SameSite=Lax` (ADR-003), lo que cubre la mayoría de los casos, pero no es una defensa que se pueda comprobar con una prueba ni cubre los navegadores que tratan `Lax` distinto.
3. **Sin cabeceras de seguridad** y sin garantía de que no haya secretos en un repositorio que es público.

## 2. Decisión

### 2.1 CSRF por verificación de origen, no por token [CONFIRMADO en #18]

Una guarda global (`OrigenGuard`, `apps/api/src/seguridad/`) mira las peticiones que **modifican** datos (todas menos `GET`, `HEAD` y `OPTIONS`):

1. Con encabezado `Origin`: debe ser el propio sitio (su host coincide con `Host`) o estar en `ORIGENES_PERMITIDOS`. `Origin: null` se rechaza.
2. Sin `Origin` pero con `Sec-Fetch-Site`: solo `same-origin` o `none`.
3. Sin ninguno de los dos: no es un navegador (curl, otro servidor, las pruebas) y pasa.

Si no pasa, **403** con `codigo: origen_no_permitido`, antes de que se ejecute nada, y una línea en el registro del servidor. Es la defensa que OWASP llama «Verifying Origin With Standard Headers» y se suma a `SameSite=Lax`.

**Desviación del plan, registrada.** `docs/PLAN_EJECUCION.md` (#18) proponía un token con doble envío (`X-CSRF-Token`). Se cambió por este motivo: un navegador **siempre** envía `Origin` (y `Sec-Fetch-Site`) en una petición entre sitios que modifica datos, así que la verificación cubre el mismo ataque sin que la interfaz tenga que guardar y reenviar un token, sin un endpoint para entregarlo y sin otra pieza de estado que pueda salir mal. [PENDIENTE] Confirmar esta desviación con quien revisa el PR.

### 2.2 Límite de intentos de ingreso, guardado en la base [CONFIRMADO en #18]

- **Cuánto:** 5 intentos por usuario y 30 por IP en una ventana de 15 minutos [SUPUESTO: sin medir con uso real]. El de IP es más alto porque una oficina puede salir por una sola IP y los errores de digitación son normales. Al pasarse, **429** con `Retry-After` (segundos) y `codigo: demasiados_intentos`.
- **Se cuenta lo escrito, exista el usuario o no**, normalizado (minúsculas, sin espacios de los lados, 64 caracteres como máximo). Así un usuario inexistente se limita igual que uno real y la respuesta no delata cuáles existen.
- **Tabla `intentos_ingreso`** (migración 0007). Se guarda en la base y no en la memoria del proceso porque Cloud Run puede tener varias instancias: un contador en memoria dejaría que cada instancia concediera sus propios intentos y se reiniciaría con cada arranque en frío. La ventana se mide con `now()` de PostgreSQL, no con el reloj de cada instancia.
- **El intento se reserva antes de verificar la clave** (se cuenta, se registra, se vuelve a contar). Dos consecuencias buscadas: (1) un usuario ya bloqueado **no cuesta una verificación de argon2**, que es lenta a propósito (un atacante no puede usar el bloqueo para gastar CPU); (2) aunque lleguen muchos intentos a la vez, a lo sumo 5 llegan a verificarse (probado con 20 simultáneos).
- **Un ingreso correcto borra los intentos del usuario** y aprovecha para limpiar lo que tenga más de un día. Un ingreso correcto no cuenta contra la IP.
- **Insistir estando bloqueado no registra nada:** no alarga el bloqueo ni hace crecer la tabla.
- **De dónde sale la IP:** de lo que Express ve según `CONFIAR_EN_PROXY` (cuántos proxies hay delante; Cloud Run: 1), nunca de un encabezado que el cliente pueda escribir a su gusto. Con un valor mal puesto el límite por IP deja de servir: con 0 detrás de un proxy, todos parecen la misma IP; con un número mayor al real, cualquiera puede escribir la suya. [POR VERIFICAR] que 1 sea el valor correcto en Cloud Run al primer despliegue (`docs/despliegue.md`).

### 2.3 Cabeceras de seguridad con helmet [CONFIRMADO en #18]

`helmet()` con sus valores por defecto, aplicado igual en `main.ts` y en las pruebas (`configurarSeguridad`): política de contenido restrictiva, `X-Content-Type-Options: nosniff`, `Strict-Transport-Security`, sin `X-Powered-By`. Hoy la API solo devuelve JSON y PDF. [PROPUESTA] Cuando la API sirva la interfaz web (V2-M4) hay que revisar la política de contenido con la interfaz real.

### 2.4 Sin secretos en el repositorio [CONFIRMADO en #18]

Un trabajo de CI (`secretos`) corre **gitleaks sobre todo el historial** (el repositorio es público: un secreto subido por error ya está expuesto aunque después se borre). Usa la imagen oficial fijada por huella, no la acción, que pide licencia a las organizaciones. La primera ejecución local halló **un falso positivo** (`infra/docker-compose.yml`, línea de `curl --user` que usa variables de entorno, no un secreto literal); se permite en `.gitleaks.toml` limitado a ese archivo y esa regla, con su justificación, y se comprobó que la misma línea con credenciales literales en cualquier otro archivo **sí** se detecta. También se comprobó con un token falso que el escáner detecta secretos. Además, la regla de siempre: las claves reales viven en Secret Manager y `.env` no se sube.

**Nota del 23 de noviembre de 2026 (alcance del escaneo) [CONFIRMADO]:** «todo el historial» significa todo lo alcanzable desde la confirmación que se prueba (`--log-opts=HEAD`), no el de todas las ramas. Con el valor por defecto de gitleaks (`--all`) y `fetch-depth: 0`, un hallazgo en la rama sin fusionar de un PR hacía fallar el trabajo `secretos` de todos los demás PR, aunque sus propias ramas estuvieran limpias (reproducido en local: una rama limpia daba 0 hallazgos con `HEAD` y 2 con `--all` al existir la otra rama como referencia remota; la rama con el hallazgo seguía marcándolo con `HEAD`). La decisión del apartado no cambia: el historial que se va a fusionar se escanea entero.

### 2.5 Auditoría

Se agrega `ingreso_bloqueado` y se registra **una sola vez**, en el intento fallido que agota el límite; los rechazados después no se auditan (insistir no llena `auditoria`). El detalle no incluye el nombre escrito. Los rechazos de la guarda de origen **no** se auditan: son ruido sin valor documental y cada uno sería una escritura que cualquiera puede provocar.

## 3. Alternativas descartadas

- **Token CSRF con doble envío** (el plan): ver 2.1. Se descarta por más piezas que mantener para el mismo resultado contra navegadores.
- **Contador de intentos en memoria** o `@nestjs/throttler` solo: no se comparte entre instancias de Cloud Run y se pierde al reiniciar. El plan preveía throttler **más** bloqueo en la base; la base sola cubre las dos cosas con menos código.
- **Bloquear solo por IP:** una oficina entera comparte IP y un atacante con muchas IPs lo esquiva. **Bloquear solo por usuario:** permite probar un millón de usuarios desde una IP. Se usan las dos.
- **Bloqueo permanente hasta que un administrador lo levante:** hoy no hay forma de restablecer claves (ADR-008) ni pantalla para hacerlo; sería un candado sin llave.
- **Contar solo los intentos fallidos, después de verificar:** deja que muchos intentos simultáneos pasen todos antes de que alguno se registre.
- **La acción oficial de gitleaks:** exige licencia a las organizaciones; la imagen no.

## 4. Consecuencias y límites

- **Un tercero puede bloquear a un usuario** (hacer 5 intentos con su nombre) durante hasta 15 minutos. Es el costo de cualquier bloqueo por usuario. No se agrega un desbloqueo manual: se levanta solo. [SUPUESTO] aceptable para un prototipo; con uso real habría que decidir si vale la pena otra defensa (por ejemplo, retraso progresivo).
- **La API no tiene CORS** (nunca se habilitó): un navegador de otro sitio no puede ni leer las respuestas. La guarda de origen cubre el otro lado: que no pueda modificar.
- **La verificación de origen no se probó con navegadores reales**, solo con peticiones construidas a mano con los encabezados que un navegador envía. [POR VERIFICAR] cuando exista la interfaz (V2-M4).
- **Límites y ventana son constantes en el código** (`limite-ingreso.ts`), no variables de entorno, para que no se puedan aflojar por error en un despliegue.
- **Sigue sin haber cambio de clave ni restablecimiento** (ADR-008, sección 4). Es un límite del sistema, no de este ADR.
- **Fuera de alcance:** autenticación de dos factores, detección de contraseñas filtradas, y cualquier cosa de infraestructura (cortafuegos, WAF), que corresponde a un proyecto distinto.
