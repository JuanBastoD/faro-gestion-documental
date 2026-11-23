# ADR-012: Interfaz web bajo `/app/`, servida por la propia API

- **Fecha:** 22 de noviembre de 2026
- **Estado:** Aceptada al fusionar este documento
- **Issue:** #23
- **Relacionada con:** ADR-001 (pila: «estructura de la interfaz web y su biblioteca de componentes» quedó pendiente para #23 a #25), ADR-002 (la API REST es el contrato único), ADR-003 (sesión por cookie), ADR-009 (guarda de origen, límite de intentos, cabeceras), `docs/matriz-de-roles.md`
- **Etiquetas de certeza:** [CONFIRMADO] construido y probado en el repositorio; [PROPUESTA] decidido pero aún no construido; [POR VERIFICAR] falta un dato o una prueba; [SUPUESTO] razonable pero sin medir; [DESCARTADO] considerado y rechazado.

## 1. Contexto

Hasta #22 el sistema era solo una API. El hito V2-M4 agrega la interfaz que usan las personas de la entidad. Este ADR cubre la parte de #23: la estructura de `apps/web`, cómo llega al navegador y cómo habla con la API. Las pantallas de carga y de versión nueva (#24) y las de usuarios y auditoría (#25) se construyen sobre esta base.

Restricciones que condicionan la decisión:

1. **Una sola pieza que desplegar.** El prototipo irá a Cloud Run (#20) y la entidad no tiene área de TI que opere un segundo servicio [SUPUESTO: alcance del proyecto].
2. **La API ya tiene su política de seguridad** (ADR-009): cookie `HttpOnly` y `SameSite=Lax`, guarda que compara `Origin` con `Host`, límite de intentos y `helmet()` con su política de contenido por defecto. Una interfaz en otro origen exigiría CORS y soltar varias de esas defensas.
3. **Datos ficticios, pero repositorio y despliegue públicos.** Nada de recursos de terceros (fuentes, scripts, imágenes) que el navegador pida a otro sitio.
4. **Uso en celular.** El criterio de #23 exige que la interfaz sirva desde 360 px de ancho.

## 2. Decisión

### 2.1 Dónde vive: `/app/`, en el mismo origen que la API [CONFIRMADO en #23]

La interfaz compilada se sirve **bajo `/app/`** desde el mismo proceso de la API. Las rutas de la API (`/auth`, `/series`, `/documentos`, `/usuarios`, `/auditoria`, `/health`) **no se mueven**. Vite se configura con `base: '/app/'` y el enrutador con `basename`, de modo que una dirección como `/app/documentos/12` es de la interfaz y `/documentos/12` es de la API.

El servicio de archivos es un **middleware de Express registrado con `app.use` en `main.ts`, fuera del enrutador de Nest** (`apps/api/src/interfaz/servir-interfaz.ts`). Por eso no aparece como endpoint de la API y no entra en `docs/matriz-de-roles.md`: la prueba de la matriz recorre las rutas del enrutador y sigue pasando sin tocarla. Una prueba (`servir-interfaz.spec.ts`) comprueba además que registrar la interfaz no agrega ninguna capa con ruta (`capa.route`) al servidor.

Reglas del middleware:

- Solo atiende `GET` y `HEAD`; cualquier otro método sigue su camino y la API responde como antes.
- `/app` redirige (302) a `/app/` conservando la consulta.
- Un archivo con extensión que no existe responde **404 JSON**, no `index.html` con un 200 que escondería un error de compilación o un enlace roto. Una ruta sin extensión (`/app/documentos/12`) responde `index.html`, que es lo que necesita un enrutador del lado del cliente al recargar la página.
- Caché: los archivos de `assets/` (con huella en el nombre) llevan `max-age` de un año e `immutable`; el resto, una hora; `index.html`, `no-cache`, para que una versión nueva se vea al recargar.
- Defensa contra recorrido de rutas: se decodifica la ruta y se rechazan `..`, `\` y bytes NUL antes de tocar el disco; se sirve con `root` fijo.
- Si la carpeta compilada no existe (no hay `index.html`), la API **arranca igual, sin interfaz**, y lo dice en el registro. La carpeta es `apps/web/dist` salvo que la variable opcional `INTERFAZ_RUTA` indique otra (validada en `entorno.ts`, con prueba; documentada en `.env.example`).

### 2.2 Qué hace `GET /` [CONFIRMADO en #23]

Antes de este cambio `GET /` respondía 404 (`Cannot GET /`). **Ahora, si hay interfaz compilada, redirige (302) a `/app/`**; si no la hay, sigue dando 404 como antes. Es la decisión más conservadora: quien abre la dirección raíz del servicio llega a la interfaz, y quien consume la API no pierde nada porque `/` nunca fue una ruta de la API. Se usa 302 y no 301 para no dejar una redirección permanente en la caché de los navegadores si más adelante la raíz cambia de destino.

### 2.3 Pila y estructura de `apps/web` [CONFIRMADO en #23]

| Pieza | Elección |
|---|---|
| Lenguaje y marco | React 19 con TypeScript en modo estricto, empaquetado con Vite |
| Enrutamiento | React Router (`BrowserRouter` con `basename` tomado de `import.meta.env.BASE_URL`) |
| Estilos | CSS propio, móvil primero, sin biblioteca de componentes, sin fuentes externas (pila tipográfica del sistema) |
| Pruebas | Vitest, Testing Library y jsdom, con la API simulada a nivel de `fetch` |
| Lint | Oxlint con tipos, con las reglas de React y de accesibilidad (`jsx-a11y`) |

Carpetas: `src/api/` (cliente HTTP), `src/sesion/` (contexto y guarda de rutas), `src/paginas/`, `src/componentes/`, `src/utilidades/`, `src/pruebas/` (ayudas de prueba).

**Cliente HTTP tipado a mano**, no generado. Un solo `pedir<T>()` en `src/api/cliente.ts` y un módulo por recurso (`auth`, `series`, `documentos`, `usuarios`, `auditoria`) con los tipos de las respuestas. Motivo: los endpoints de la API caben en cinco módulos y su formato de error es uno solo; un generador de clientes agregaría una etapa de compilación y una dependencia para un contrato que cabe en un archivo. El módulo de documentos ya trae los tipos que necesitará #24 (`Candidato`, `DocumentoCreado`, `ConflictoDeDuplicado`, `UbicacionDeVersion`) y los de usuarios y auditoría están listos para #25, de modo que esas historias no vuelven a tocar el cliente.

Comportamientos del cliente que fijan las pruebas:

- **401** en cualquier petición salvo el ingreso y «quién soy» → se avisa a la sesión, que vuelve a `/ingreso` con el aviso «Tu sesión terminó».
- **429** → el mensaje usa `Retry-After` («Intenta de nuevo en 15 minutos»).
- Red caída → estado 0 con mensaje propio; 5xx → mensaje propio sin mostrar el cuerpo; 4xx → el mensaje que manda la API.
- Una petición cancelada (al cambiar de página) no se trata como error.

### 2.4 Sesión, rutas y menú por rol [CONFIRMADO en #23]

- La sesión es la cookie `faro_sesion` (ADR-003); la interfaz no guarda tokens en `localStorage`. Al montar pide `GET /auth/yo`.
- Rutas: `/ingreso`; protegidas, `/documentos` (listado), `/documentos/:id` (detalle); `/` va a `/documentos`.
- **Guarda de rutas** por rol (`RutaProtegida`): sin sesión lleva a `/ingreso` y, tras ingresar, **vuelve a donde se quería ir** (solo a destinos internos); con sesión pero rol insuficiente muestra «No tienes permiso» (la API sigue siendo la que decide: la guarda es comodidad, no seguridad).
- Menú por rol: consulta ve «Documentos»; administrador y editor ven además «Cargar documento»; el administrador ve también «Usuarios» y «Auditoría».
- **Pantallas marcador** (existen para que #24 y #25 solo reemplacen el contenido, con la ruta, el rol y el menú ya resueltos): `/documentos/nuevo` y `/documentos/:id/version` (administrador y editor; issue #24) y `/usuarios` y `/auditoria` (administrador; issue #25).
- El estado del listado (`q`, `serieId`, `pagina`) vive **en la URL**: se puede compartir, recargar y volver atrás sin perderlo.

### 2.5 Verificación con navegador real [CONFIRMADO en #23]

Las pruebas con jsdom no ven la política de contenido ni la guarda de origen. Se verificó con Chromium 159 (Playwright 1.65.1, fuera del repositorio) contra el servidor compilado sirviendo `/app/`, con los usuarios ficticios `admin.demo` y `consulta.demo`, a 1280 px y a 360×740 px: ingreso (correcto, con clave errónea y hasta el 429), listado de 25 documentos en 3 páginas, búsqueda sin tildes, filtro por serie, paginación, detalle con 4 versiones, descarga, rutas marcador, recarga profunda, sesión que termina a mitad de uso y cierre de sesión. El resultado completo está en la descripción del PR #54: 60 de 60 comprobaciones, **sin errores ni avisos en la consola, sin violaciones de la política de contenido y sin respuestas ≥ 400 que la prueba no hubiera provocado a propósito**. axe-core (WCAG 2.1 A y AA) no halló violaciones en ingreso, listado, listado con búsqueda, detalle y pantalla marcador, ni en listado y detalle a 360 px.

**Control negativo:** la misma ejecución inserta un `<script>` en línea y comprueba que la política de contenido lo bloquea y que el bloqueo aparece en la consola. Es la prueba de que «sin violaciones» no significa «no estábamos mirando».

### 2.6 Política de contenido (helmet) [CONFIRMADO en #23, con límite]

La política por defecto de `helmet()` (`default-src 'self'`, `script-src 'self'`, `script-src-attr 'none'`, `style-src 'self' https: 'unsafe-inline'`, `img-src 'self' data:`, `font-src 'self' https: data:`, `object-src 'none'`, `upgrade-insecure-requests`) **no bloquea nada de la interfaz** en Chromium, así que **no se cambió** (ADR-009 conserva su decisión; se le agregó una nota al final). La interfaz es compatible porque no usa scripts ni manejadores en línea, ni orígenes externos. Para que eso no se rompa sin que nadie lo note, `apps/web/src/indice.test.ts` comprueba en cada ejecución del CI que `index.html` no tiene código en línea, manejadores `on…=`, estilos en línea ni referencias a otros orígenes.

### 2.7 Guarda de origen en desarrollo [CONFIRMADO en #23]

En desarrollo la interfaz corre en Vite (`localhost:5173`) y reenvía a la API (otro puerto). La guarda de ADR-009 compara `Origin` con `Host`; si el proxy reescribiera `Host` (opción `changeOrigin: true` de Vite), el navegador enviaría `Origin: http://localhost:5173` y la API vería `Host: 127.0.0.1:<puerto>`: **403 `origen_no_permitido` en el ingreso**. Por eso `vite.config.ts` fija **`changeOrigin: false`**.

Observado en Chromium con Vite en 5173 y la API en otro puerto: ingreso 200, listado, búsqueda y descarga sin error y cierre de sesión 204. Con `curl` contra la API, el mismo `Origin` con `Host: localhost:5173` pasa la guarda (llega a la verificación de clave: 401), con `Host: 127.0.0.1:<puerto>` da 403, y un `Origin` de otro sitio da 403. Esa comparación con `changeOrigin: true` se hizo a mano con `curl`, **no con Vite en ese modo**: que Vite reescribiría `Host` es comportamiento documentado de su proxy, no algo que se haya medido aquí [SUPUESTO]. Servida por la API (modo compilado), la interfaz y la API comparten origen y la guarda no interviene.

## 3. Alternativas descartadas

- **[DESCARTADO] Interfaz en la raíz (`/`), moviendo las rutas de la API a otro prefijo.** Es la URL más limpia, pero cambia el contrato de una API ya documentada, probada (matriz de roles, pruebas de aceptación, README). Mover todos los endpoints para ganar una barra no compensa el riesgo; `GET /` redirigiendo a `/app/` da el mismo efecto para quien escribe la dirección.
- **[DESCARTADO] Sitio separado (otro servicio u otro origen) con CORS.** Obliga a habilitar CORS con credenciales, a revisar `SameSite` (si el sitio fuera otro dominio, la cookie `Lax` no viajaría en sus peticiones `fetch`), a debilitar la guarda de origen con `ORIGENES_PERMITIDOS` y a desplegar y versionar dos piezas. Contradice las restricciones 1 y 2.
- **[DESCARTADO] Biblioteca de componentes (MUI, Chakra, Tailwind con plantillas) y fuentes web.** Aumentan el tamaño, exigen relajar la política de contenido (estilos en línea, fuentes de un CDN) y no se justifican con cuatro pantallas. El CSS propio pesa 7 kB (2 kB comprimido) y el JavaScript 281 kB (88 kB comprimido).
- **[DESCARTADO] Cliente HTTP generado a partir de un esquema OpenAPI.** La API no publica un esquema OpenAPI (no hay ni la dependencia) y generarlo es un trabajo aparte; ver 2.3.
- **[DESCARTADO] Interfaz renderizada en el servidor** (como el prototipo v1). Ya descartada en ADR-001 y ADR-002.
- **[DESCARTADO] Servir `index.html` para cualquier ruta, incluidos los archivos que faltan.** Esconde errores; ver 2.1.
- **[DESCARTADO] Ruta del middleware dentro del enrutador de Nest** (un controlador que sirva archivos). Habría entrado en la matriz de roles como endpoint público y obligado a modificarla; fuera del enrutador no hay nada que decidir.

## 4. Consecuencias y límites

- **El navegador tiene una dirección más que recordar** (`/app/`); `GET /` la cubre. Los enlaces profundos (`/app/documentos/12`) funcionan al recargar.
- **La interfaz compilada hay que construirla antes de arrancar la API** para verla; si no, la API arranca sin ella (dice cuál carpeta buscó). En el contenedor, el `Dockerfile` la compila en una etapa propia y copia solo `apps/web/dist` (sin código fuente ni dependencias de la web).
- **Una sola política de contenido para la API y la interfaz.** Si una pantalla futura necesita algo que la política prohíbe (un script en línea, una fuente externa), hay que decidirlo aquí, no aflojar la política en silencio.
- **Chromium fue el único navegador probado.** [POR VERIFICAR] Firefox y Safari: la comprobación de políticas y de la guarda de origen no se repitió allí. En particular, `upgrade-insecure-requests` está en la política por defecto; en Chromium no afecta a `http://localhost` ni a `http://127.0.0.1`, pero [SUPUESTO] otros navegadores podrían forzar HTTPS en esos orígenes y dejar la interfaz sin recursos al probar el servidor compilado en local con HTTP. En desarrollo (Vite) y en la nube (HTTPS) no aplica.
- **La descarga es un enlace (`<a download>`)**, no una petición de la interfaz: si la sesión terminó con la página abierta, el enlace llega a la API sin sesión y el navegador recibe el error 401 en lugar de volver al ingreso. [POR VERIFICAR] qué muestra cada navegador en ese caso; no se resolvió porque cambiar a descarga por `fetch` y `Blob` carga el archivo completo en memoria.
- **Los contrastes de color se midieron a mano** con la fórmula de WCAG 2.1 (los pares principales están entre 7,2:1 y 16,1:1; el borde de los campos 3,4:1) y axe-core no halló violaciones; no se hizo una revisión con lector de pantalla. [POR VERIFICAR] con una persona usuaria real.
- **El estado «cargando» y los errores se manejan por pantalla**, no con una capa global de notificaciones; es suficiente con cuatro pantallas y se revisa cuando #24 agregue formularios largos.
- **Fuera de alcance de #23:** cargar documentos, subir y restaurar versiones, confirmar duplicados (#24), administrar usuarios y consultar la auditoría (#25).

## 5. Referencias

- Issue #23 y PR #54; issues #24 y #25 (pantallas que continúan).
- `apps/api/src/interfaz/servir-interfaz.ts` y su prueba; `apps/api/src/config/entorno.ts` (`INTERFAZ_RUTA`); `apps/web/` (`vite.config.ts`, `src/`); `apps/web/src/indice.test.ts`; `apps/api/Dockerfile`.
- ADR-009 (guarda de origen y cabeceras), ADR-003 (sesión), ADR-001 y ADR-002 (pila y arquitectura).
- Vite: documentación de `server.proxy` y `base`; React Router: `basename`. OWASP: *Cross-Site Request Forgery Prevention Cheat Sheet*, «Verifying Origin With Standard Headers».

## 6. Actualización del 23 de noviembre de 2026 (issue #24, PR #58)

Esta sección registra cómo #24 aplicó las decisiones de arriba y lo que decidió dentro de ellas. **No cambia nada de lo decidido en las secciones 1 a 5**: la interfaz sigue bajo `/app/`, en el mismo origen, con la política de contenido por defecto de helmet y sin dependencias nuevas. Una decisión grande (cambiar de pila, de origen o de política) iría en un ADR nuevo, no aquí.

### 6.1 Decisiones de #24

- **[CONFIRMADO] El PDF no se incrusta: se abre en otra pestaña.** La política por defecto de helmet restringe `object-src` y no declara `frame-src`, así que un `<iframe>` o `<object>` con una dirección `blob:` quedaría bloqueado, y aflojar la política queda fuera de lo decidido en 2.6. La pantalla de comparación crea una dirección con `URL.createObjectURL` para el archivo que se intenta cargar (un enlace con `target="_blank"` y `rel="noopener noreferrer"`), la libera con `URL.revokeObjectURL` al salir, y enlaza la descarga del documento existente por la ruta de la API. Una prueba comprueba que no hay `iframe`, `object` ni `embed` y que la dirección se libera.
- **[CONFIRMADO] «Es el mismo documento» no llama a la API.** El contrato solo tiene dos decisiones (`nueva_version` y `documento_distinto`) y no hay nada que guardar: la pantalla lleva al documento existente con un aviso. Alternativa descartada: reenviar el archivo con una decisión inventada, que habría creado una versión o un documento no deseados.
- **[CONFIRMADO] «Es una versión nueva» reenvía `documentoId` y `motivo`; «es otro documento» reenvía `justificacion`** (obligatoria, 500 caracteres como máximo). El cliente (`formularioDeCarga`) envía solo los campos que valen para la decisión elegida. Con `nueva_version` la API ignora el título, el expediente, la subserie y la fecha escritos; la pantalla lo dice. Dos pruebas de mutación lo protegen (ver 6.3).
- **[CONFIRMADO] El formulario sigue montado, solo oculto (`hidden`), mientras se muestra la pantalla de duplicado.** Así «Volver y corregir los datos» conserva el archivo elegido (un `<input type="file">` no se puede volver a llenar por código) y lo escrito. Alternativa descartada: desmontarlo y guardar los valores en el estado, que perdería el archivo.
- **[CONFIRMADO] Un archivo idéntico (409 `duplicado_exacto`) no se puede cargar:** no se ofrece decidir nada; el aviso dice dónde está y enlaza al documento.
- **[CONFIRMADO] Restaurar es una confirmación en el mismo lugar** (un formulario bajo la versión, no un cuadro de diálogo modal): explica que se crea una versión nueva y que no se borra nada, pide un motivo opcional y devuelve el foco al botón si se cancela. Alternativa descartada: `<dialog>` modal, que obliga a atrapar el foco y complica el teclado y el lector de pantalla sin ganar nada con pocas versiones por documento.
- **[CONFIRMADO] Los avisos de éxito viajan en el estado de la navegación** (`navigate(ruta, { state: { aviso } })`); el detalle los copia a su estado y los borra del historial (`replace`), de modo que al recargar no reaparecen. Alternativa descartada: parámetros en la URL, que se compartirían y mostrarían un aviso falso.
- **[CONFIRMADO] Todos los mensajes de error están en `apps/web/src/api/errores.ts`** (`traducirError(error, operacion)`), con pruebas por código de estado y por operación (carga, versión, restauración). Ninguna pantalla muestra el texto del servidor tal cual; el 400 de validación se traduce campo por campo para señalar cada campo y poner el foco en el primero. Con esto se cierra lo que la sección 4 dejó abierto («se revisa cuando #24 agregue formularios largos»): se mantiene el manejo por pantalla y no se agrega una capa global de notificaciones [PROPUESTA: revisar si #25 la pide].
- **[PROPUESTA] La fecha del documento no puede ser anterior a 1900** (`ANIO_MINIMO` en `validacion.ts`). La API solo exige una fecha de calendario real; el tope evita un año mal escrito (por ejemplo `0026`) que la API aceptaría. Si la entidad tiene documentos anteriores, se cambia esa constante.
- **[CONFIRMADO] Validación en el navegador y en la API.** El navegador avisa antes de enviar (PDF por tipo o extensión, no vacío, hasta 20 MB, longitudes, fecha real) para no subir 20 MB y esperar un 413; la API valida de nuevo y es la que decide (por ejemplo, el contenido real del PDF: 415).
- **[CONFIRMADO] Envío único.** Una referencia (`enviandoAhora`) bloquea un segundo envío aunque el botón aún no se haya deshabilitado en el siguiente pintado, y la petición en curso se cancela (`AbortController`) si se sale de la pantalla.

### 6.2 Consecuencias y límites nuevos

- **El PDF nuevo se ve solo en otra pestaña.** Quien compara no tiene ambos documentos en la misma pantalla; el porcentaje de parecido y los datos de ambos sí están lado a lado (apilados en celular). [POR VERIFICAR] con personas de la entidad si esto basta para decidir.
- **La interfaz no muestra qué texto cambió.** El porcentaje de parecido lo calcula la API sobre el texto extraído; un visor de diferencias queda fuera del alcance del prototipo [PROPUESTA].
- **Restaurar crea una versión; no hay «deshacer».** Es coherente con el control de versiones para trazabilidad (la versión anterior no se borra), y el 409 `versionVigente` evita restaurar lo que ya es vigente.
- **Los contrastes de los componentes nuevos se midieron** con la misma fórmula de WCAG 2.1 que en #23 (los pares están en el encabezado de `estilos.css`); no se revisó con lector de pantalla [POR VERIFICAR].

### 6.3 Verificación

El detalle está en el PR #58: pruebas de la web (Vitest y Testing Library), pruebas de mutación y un recorrido en Chromium real contra el servidor compilado a 1280 y 360 px. Las capturas de pantalla se guardan fuera del repositorio, para el manual de usuario.

## 7. Actualización del 23 de noviembre de 2026 (issue #25, PR #62)

Como la sección 6, esta registra cómo #25 aplicó las decisiones de arriba y lo que decidió dentro de ellas. **No cambia nada de lo decidido en las secciones 1 a 5**: misma ruta `/app/`, mismo origen, misma política de contenido, sin dependencias nuevas y **sin tocar `apps/api`**. Las pantallas de usuarios y de auditoría usan solo lo que la API ya ofrece.

### 7.1 Decisiones de #25

- **[PROPUESTA] La clave inicial de un usuario nuevo la escribe el administrador.** La API exige una clave en `POST /usuarios` (12 a 256 caracteres) y no hay correo ni enlace para que la persona la elija, así que alguien tiene que escribirla. El campo es de tipo contraseña, trae `autocomplete="new-password"` (para que el gestor de claves del administrador no le ofrezca la suya) y una casilla «Mostrar la clave mientras la escribo». Con la casilla a la vista no hace falta un segundo campo de confirmación. La clave no se guarda en el estado de la pantalla tras crear, no va en la URL ni en el historial ni en el almacenamiento del navegador (se comprobó en Chromium) y el aviso de éxito dice que hay que entregarla **por otro medio**, porque el sistema no vuelve a mostrarla. Alternativas descartadas: generar la clave en el navegador y mostrarla una vez (se reserva para «Restablecer clave», #51, donde es lo habitual); pedirla dos veces (con la casilla el administrador puede comprobar lo escrito, y el segundo campo estorba más en celular). **Es una decisión que corresponde al usuario**: se tomó la opción más sencilla y que no inventa contrato nuevo. [POR VERIFICAR] Cuando se fusione #57 (cambio de clave obligatorio en el primer ingreso), conviene que el administrador sepa que la clave inicial es temporal; hoy la persona la conserva mientras no la cambie.
- **[PROPUESTA] El rol marcado por omisión al crear es Consulta,** el de menos permisos: un descuido del administrador crea a alguien que solo puede leer, no a alguien que puede administrar. Cada rol muestra su descripción (la de la matriz de roles) para que la elección sea informada.
- **[CONFIRMADO] Cambiar el rol y desactivar piden confirmación en el mismo lugar** (un formulario bajo la tarjeta, no un cuadro modal; mismos motivos que en 6.1 para «Restaurar»), con el foco en el título, el efecto explicado («rige al instante», «cierra sus sesiones») y el error de la API dentro del propio panel, que queda abierto. **Reactivar es inmediato:** no pierde nada y se puede deshacer con «Desactivar»; el aviso dice que ya puede ingresar. Alternativa descartada: confirmar también la reactivación, que agregaría un paso sin evitar ningún daño.
- **[CONFIRMADO] La cuenta propia.** La API deja desactivarse o cambiarse el rol uno mismo mientras quede otro administrador activo (si no, 409 `ultimo_administrador`). La interfaz lo permite con una advertencia («Es tu propia cuenta»): al desactivarse sale al ingreso (la API ya cerró la sesión: la llamada de cierre recibe 401 y se ignora, y no se muestra «Tu sesión terminó» porque fue una decisión), y al cambiarse el rol vuelve a leer la sesión y la guarda de rutas muestra «sin permiso» al instante. Alternativa descartada: impedirlo en la interfaz, que repetiría una regla que decide la API. [PROPUESTA] Si la entidad prefiere impedirlo, basta con ocultar los botones de la tarjeta «Tú».
- **[CONFIRMADO] Sesión: `refrescar()`.** Se agregó a la sesión una función que vuelve a preguntar quién es el usuario (`GET /auth/yo`). Se usa cuando una petición de administración da 403 «de rol» (el rol cambió en otro lado: la API lee el rol de la base en cada petición, ADR-003 y ADR-008) y tras cambiarse el propio rol. Si la API ya no reconoce la sesión vuelve al ingreso con el aviso; si no hay red conserva lo que había. El 403 `origen_no_permitido` no pide releer la sesión: no es un problema de rol.
- **[CONFIRMADO] Fechas del filtro de auditoría: día entero en hora de Colombia** (UTC-5 fijo, sin horario de verano). La API recibe `desde` y `hasta` como fechas completas y compara con «menor o igual»: enviar `2026-11-22` como `hasta` valdría medianoche UTC y dejaría fuera casi todo ese día. La interfaz envía `desde` como las 00:00:00.000 y `hasta` como las 23:59:59.999 de Colombia, y todas las horas se muestran en esa zona aunque el navegador esté en otra (se comprobó con el navegador en Tokio). Dos pruebas de mutación lo protegen.
- **[CONFIRMADO] Los filtros viven en la URL** (`usuarioId`, `accion`, `documentoId`, `desde`, `hasta`, `pagina`): una consulta se puede compartir. Un valor inválido escrito a mano en la URL se descarta en vez de provocar un 400, y una página fuera de rango lleva a la última.
- **[CONFIRMADO] La lista de acciones del filtro son las 14 que existen en esta rama de la API.** Los textos de `ccd_importado`, `clave_cambiada` y `clave_restablecida` ya están (para mostrarlas si aparecen), pero no se ofrecen como filtro hasta que se fusionen #19 y #57. [PENDIENTE] Agregarlas a `ACCIONES_FILTRABLES` en ese momento. Una prueba lee `apps/api/src/auditoria/acciones.ts` y falla si el filtro ofrece una acción que la API no tiene o si a una acción de la API le falta su texto.
- **[CONFIRMADO] Tarjetas, no tabla,** para usuarios y eventos: coherente con las demás pantallas y sin desplazamiento horizontal a 360 px. El detalle de cada evento se muestra como texto (React lo escapa); nunca como HTML.
- **[CONFIRMADO] Los mensajes de error de estas pantallas están en `apps/web/src/api/errores-administracion.ts`,** con el mismo patrón que `errores.ts` (6.1) y pruebas por código y operación. Con esto se cierra el [PROPUESTA] de 6.1: #25 no pidió una capa global de notificaciones; se mantiene el manejo por pantalla.
- **[CONFIRMADO] Un arreglo aparte, en su propio commit (87ba312):** el aviso «Tu sesión terminó» se cortaba dentro de la tarjeta de ingreso porque `.aviso` era `display: inline`. Ahora es de bloque, con una prueba sobre `estilos.css`.
- **[CONFIRMADO] axe encontró un defecto real en el navegador** que las pruebas de jsdom no ven: el botón «Cambiar rol» tenía el nombre accesible «Cambiar el rol de X», que no contiene su texto visible (WCAG 2.5.3, etiqueta en el nombre; quien usa reconocimiento de voz dice «Cambiar rol»). Ahora es «Cambiar rol de X» y una prueba comprueba que todos los botones de la tarjeta lo cumplen.
- **[CONFIRMADO] Se borró el componente `Marcador`:** ya no lo usa ninguna ruta.

### 7.2 Consecuencias y límites nuevos

- **No hay paginación de usuarios:** la API devuelve todos. Con 8 funcionarios y 21 contratistas basta [POR VERIFICAR] si la entidad crece.
- **No se puede editar el nombre, restablecer una clave ni borrar a nadie:** la API no lo ofrece (los usuarios no se borran, para conservar la trazabilidad). Restablecer clave es la etapa siguiente (#51) y depende de fusionar #57.
- **El administrador conoce la clave inicial de cada persona** hasta que esta la cambie. Es una consecuencia de la decisión de arriba, no un defecto oculto.
- **Dos administradores a la vez:** la interfaz no bloquea ediciones simultáneas; la API decide y la pantalla muestra el 409 o el estado nuevo con «Actualizar la lista».
- **La auditoría no se exporta ni se busca por el texto del detalle:** solo los filtros que la API ofrece.
- **Los contrastes de los pares nuevos se midieron** (están en el encabezado de `estilos.css`); no se revisó con lector de pantalla [POR VERIFICAR].

### 7.3 Verificación

El detalle está en el PR #62: pruebas de la web (Vitest y Testing Library), pruebas de mutación y un recorrido en Chromium real contra el servidor compilado a 1280 y 360 px, con axe y sin errores de consola. Las capturas se guardan fuera del repositorio, para el manual de usuario.
