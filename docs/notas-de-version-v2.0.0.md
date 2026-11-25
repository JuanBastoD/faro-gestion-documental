# Notas de la versión v2.0.0 (BORRADOR, sin publicar)

- **Estado:** [PROPUESTA] borrador para el issue #27. Este archivo **no es un release**: el tag `v2.0.0` y el release en GitHub los crea el usuario (ver la parte B).
- **Fecha de redacción:** 23 de noviembre de 2026, actualizada el 24 y el 25 de noviembre (PR #62 a #66, fusión de los PR #53 a #66 y manual). No lleva fecha de publicación.
- **Fuentes:** [`CHANGELOG.md`](../CHANGELOG.md) (cada ítem con su issue y su PR), los ADR 0001 a 0013 en [`docs/adr/`](adr/README.md), [`README.md`](../README.md) y [`docs/PLAN_EJECUCION.md`](PLAN_EJECUCION.md).
- **Etiquetas de certeza:** [CONFIRMADO], [POR VERIFICAR], [SUPUESTO], [PROPUESTA], [DESCARTADO].
- **Estructura:** la **parte A** es el texto para pegar en el release. La **parte B** son los pasos del usuario y no va en el release.

> **Estado de los PR:** todos los PR de la parte B (#53 a #66) **se fusionaron en `main` el 25 de noviembre de 2026** (`main` = `4cd67ad`, con el CI en verde en sus siete trabajos); el texto de la parte A describe ese `main`. **Solo falta fusionar este borrador (#61).** El tag `v2.0.0` y el release no existen todavía: los publica el usuario.

---

## Parte A. Texto del release

### Faro · Gestión documental v2.0.0

Prototipo de un sistema de gestión documental para la **E.I.C.E. Faro del Catatumbo S.A.S.**, hecho como proyecto de clase (Proyecto Integrador AR, Universidad de Pamplona, 2026-2P). Reemplaza al primer incremento (`v0.1.0`, que sigue en `legacy/prototipo-v1/`). **Usa únicamente datos ficticios y no es un sistema en producción.**

El problema que atiende: los documentos de la entidad viven en computadores de oficina, en WhatsApp y en memorias USB, se piden copias de expedientes a una sola persona y se vuelve a escanear lo que ya estaba escaneado. Esta versión es un repositorio central con control de quién hizo qué.

#### Qué trae

- **Repositorio central de PDF** clasificados en un cuadro de clasificación documental **provisional** (series y subseries). Solo las subseries admiten documentos.
- **Ingreso con usuario y clave y tres roles:** administrador, editor y consulta. Consulta lee y descarga; el editor además carga, versiona y restaura; el administrador además administra usuarios y ve la auditoría.
- **Búsqueda y filtros:** por título, expediente o texto del PDF, sin importar tildes ni mayúsculas («interventoria» encuentra «Interventoría»), con filtro por serie y paginación.
- **Aviso de duplicados en dos pasos:** un archivo idéntico a otro ya cargado se rechaza y se dice dónde está; uno muy parecido (por ejemplo, un reescaneo) muestra una pantalla de comparación y **decide la persona**: no cargarlo, agregarlo como versión nueva o cargarlo como documento distinto con una justificación. La similitud nunca bloquea sola.
- **Versiones con historial:** cada documento guarda quién subió cada versión, cuándo y por qué. Restaurar una versión anterior **crea una versión nueva**; nada se edita ni se borra.
- **Auditoría que no se puede alterar:** el ingreso, las cargas, las versiones, las descargas, las decisiones ante un duplicado, los cambios de usuarios y los accesos denegados quedan registrados. El administrador la consulta con filtros (en la pantalla Auditoría); los eventos no se editan ni se borran ni por SQL.
- **Administración de usuarios y de claves:** crear usuarios, cambiar su rol, desactivarlos y reactivarlos (nunca se borran) y restablecer una clave; cada persona puede cambiar la suya. El sistema no deja sin administradores activos. La interfaz tiene la **pantalla de usuarios** (PR #62) y las pantallas de **cambio y restablecimiento de clave** (PR #66, sobre la API del PR #57); la clave temporal que fija el administrador se ve una sola vez.
- **Interfaz web** que se usa desde el computador o el celular (desde 360 px de ancho): ingreso, listado, detalle con historial y descarga, carga de documentos y de versiones nuevas, restaurar versiones, administración de usuarios y consulta de la auditoría para el administrador, y cambio y restablecimiento de clave.
- **Prueba de navegador en el CI:** una prueba con Playwright y Chromium recorre el flujo de la demostración (ingreso, carga, duplicado probable, versión nueva y auditoría) en cada PR y en `main`; el trabajo `web-e2e` no es obligatorio (PR #65).
- **Dos endurecimientos menores de seguridad** (hallazgos de baja gravedad de una revisión interna): el registro del servidor no lleva los valores de una consulta fallida (PR #63) y las respuestas de la API no se guardan en la caché del navegador, salvo la interfaz (PR #64).
- **Seguridad mínima para ponerlo en internet de pruebas:** límite de intentos de ingreso (5 por usuario o 30 por IP en 15 minutos), verificación de origen contra peticiones desde otros sitios, cabeceras de seguridad y escaneo de secretos del repositorio en cada cambio.
- **Para quien lo despliega:** imagen de contenedor, guion de despliegue a Google Cloud Run, importación del cuadro de clasificación desde un CSV (con simulación previa) y copia de seguridad de la base con guía de restauración.

#### Cómo probarlo

Requisitos: Node.js 22.13 o superior y Docker con Compose. Los pasos completos y las rutas de la API están en el [`README.md`](../README.md). En resumen, desde la carpeta del repositorio:

```
cp .env.example .env              # en Windows: copy .env.example .env  (cambia las claves de ejemplo)
npm run infra:up                  # PostgreSQL y almacén S3 locales
npm install
npm run db:migrate -w apps/api    # aplica las migraciones
npm run db:seed -w apps/api       # crea admin.demo, editor.demo, consulta.demo y el cuadro de clasificación ficticios
npm run build                     # compila la API y la interfaz
node apps/api/dist/main.js        # la interfaz queda en http://127.0.0.1:3000/app/
```

La clave de los tres usuarios `*.demo` es el valor de `SEMILLA_CLAVE` en tu `.env`. Para ver el sistema con documentos hay que cargar PDF de prueba desde la interfaz (la siembra no incluye documentos). La guía de uso está en [`docs/manual-de-usuario.md`](manual-de-usuario.md) (borrador).

#### Qué falta por verificar

- **El despliegue real en la nube** (Cloud Run, Neon y Cloud Storage): el guion y los flujos existen, pero no se han ejecutado contra cuentas reales. [POR VERIFICAR] cuotas gratuitas, versión de PostgreSQL de Neon y valor de `CONFIAR_EN_PROXY` en el primer despliegue.
- **Datos reales:** todo se probó con datos ficticios. El umbral de similitud (0,80) es provisional hasta calibrarlo con PDF reales, que exige autorización escrita de la entidad.
- **Navegadores:** la interfaz se comprobó con Chromium. Firefox y Safari son [POR VERIFICAR]. No hubo revisión con lector de pantalla ni pruebas con personas usuarias.
- **Interfaz:** las pantallas de usuarios y auditoría (PR #62) y las de cambio y restablecimiento de clave (PR #66) están en `main`. Se vieron con Chromium (capturas del manual; las de clave, de una rama local descartable que juntaba #66 y #57 antes de fusionar) y el flujo de la demostración lo recorre la prueba e2e del CI. Pendiente [PENDIENTE]: el filtro de la pantalla Auditoría aún no ofrece las acciones `ccd_importado`, `clave_cambiada` ni `clave_restablecida`. Y [CONFIRMADO]: el «Acceso denegado» por clave temporal se ve en la auditoría con texto técnico («GET /documentos; cambio de clave requerido»).
- **Recuperación de clave:** no hay «olvidé mi clave» por correo. Un administrador restablece la de otra persona; **si el único administrador olvida la suya, no hay salida por la API** [POR VERIFICAR] un comando de emergencia con acceso a la base.
- **Cifras:** esta versión no publica cifras de rendimiento ni de ahorro. Las que existan sobre el re-escaneo siguen [SIMULADO] hasta medir la línea base real.

#### Lo que no incluye

Permisos por documento o por serie (todo usuario con sesión ve todos los documentos), digitalización del archivo histórico, TRD y TVD definitivas, servidor, red e infraestructura de la entidad, OCR propio, borrado o edición de documentos y versiones, e integración con SIA o SECOP. La lista completa está en `CHANGELOG.md`, sección «Lo que NO incluye v2.0.0».

Registro completo de cambios: [`CHANGELOG.md`](../CHANGELOG.md).

---

## Parte B. Pasos del usuario para publicar (no van en el release)

Los PR #53 a #66 ya se fusionaron (con autorización del usuario; el #60 lo fusionó él a las 09:01). Lo que sigue lo hace el usuario: ningún agente crea el tag ni publica el release. Si el usuario quiere que un agente lo haga, tiene que decirlo de forma explícita y por alcance (cada autorización cubre solo lo que nombra).

### B.1 Orden en que se fusionaron los PR

Los PR #53 a #66 se fusionaron en `main` el 25 de noviembre de 2026 (hora de Colombia), cada uno con **commit de fusión**, no con squash (decisión 20 de `docs/PLAN_EJECUCION.md`: con squash, los PR apilados dan conflictos) [CONFIRMADO: `git log --first-parent origin/main` y `gh pr list --state merged`]. El orden real no fue exactamente el sugerido antes: el #57 entró después de #59, #63 y #64. Quedan solo `main` y las ramas de los PR abiertos: el repositorio **borra la rama de cada PR fusionado**, y GitHub reorientó solo hacia `main` los PR que estaban apilados (hoy todos los fusionados figuran con base `main`) [CONFIRMADO: `git ls-remote --heads origin`].

| Orden | Hora | PR | Qué es | Base original | Commit de fusión | Nota |
|---|---|---|---|---|---|---|
| 1 | 09:01 | #60 | CI: `secretos` escanea desde `HEAD` | `main` | `84b0614` | Lo fusionó el usuario. Quita el contagio de hallazgos entre ramas |
| 2 | 09:09 | #56 | CI: `tsc --noEmit` | `main` | `8767082` | Issue #52 |
| 3 | 09:13 | #53 | Copia de seguridad (#21) | `main` | `9cb7d61` | `Refs #21`: la activación es del usuario. Añade el trabajo `respaldo` del CI |
| 4 | 09:25 | #55 | Importar el cuadro desde CSV (#19) | `main` | `b5f6205` | ADR-0010 |
| 5 | 09:27 | #59 | Arreglo del bloqueo mutuo de usuarios | `main` | `27a1ff3` | Sin issue |
| 6 | 09:27 | #63 | Registro del servidor sin parámetros de consulta (H-02) | `main` | `392be79` | Sin issue |
| 7 | 09:28 | #64 | `Cache-Control: no-store` en la API (H-07) | `main` | `5dfa13f` | Sin issue |
| 8 | 09:30 | #57 | Cambio y restablecimiento de clave (#51) | `feat/19-importar-ccd` | `9c89b15` | Migración `0008`, ADR-0011. Juntos #59 y #57 rompieron `tsc --noEmit` en `main` (ver abajo) |
| 9 | 09:36 | #54 | Interfaz: ingreso, listado y detalle (#23) | `main` | `ee47229` | ADR-0012; toca `package-lock.json`. Lleva el arreglo `a51b3eb` |
| 10 | 09:39 | #58 | Interfaz: carga, versión y duplicado (#24) | `feat/23-web-listado` | `a733091` | Con un arreglo de diseño posterior (`cac8cfe`). ADR-0012, sección 6 |
| 11 | 09:43 | #62 | Interfaz: usuarios y auditoría (#25) | `feat/24-web-carga` | `3f6ca93` | Punta `8acb53f`, con dos arreglos (el aviso «ya tiene el rol …» y el texto de «Acceso denegado»). ADR-0012, sección 7 |
| 12 | 09:48 | #66 | Interfaz: cambio y restablecimiento de clave (#51) | `feat/25-web-admin` | `207b068` | Era un borrador porque dependía del #57. ADR-0012, sección 8 |
| 13 | 09:53 | #65 | Prueba e2e del flujo de la demostración (#26) | `feat/25-web-admin` | `4cd67ad` | Trabajo `web-e2e` (no obligatorio); añade `@playwright/test` y toca `package-lock.json`. ADR-0012, sección 9 |
| pendiente | — | #61 | Este borrador (#27) | `main` | — | Ver B.4 |

Hechos que dejó esa tanda [CONFIRMADO]:

- **`tsc --noEmit` falló en `main` al fusionar #59 y #57 juntos** (error TS2741: falta `debeCambiarClave` en `test/usuarios-concurrencia.e2e-spec.ts`): cada PR pasaba por separado. Lo detectó el paso `tsc --noEmit` que añadió el #56 (ejecución 45634742194, sobre `9c89b15`) y se corrigió con un commit dentro del #54 (`a51b3eb`, solo la prueba). Las ejecuciones de `main` de los demás commits de fusión salieron en verde; las de #59 (`27a1ff3`) y #63 (`392be79`) figuran como «cancelled», sin trabajos [POR VERIFICAR por qué; [SUPUESTO] el grupo de concurrencia de `main` solo admite una ejecución en espera y GitHub descarta la anterior cuando entra otra, aunque `cancel-in-progress` sea falso en `main`: se fusionaron #59, #63 y #64 en menos de dos minutos]. El código de esos commits quedó probado por las ejecuciones de los commits siguientes.
- **El CI de `main` trae ahora siete trabajos:** `api`, `legacy`, `infra`, `imagen`, `secretos` (que ya escanea solo el historial alcanzable desde `HEAD`), `respaldo` y `web-e2e` (no obligatorio). La ejecución de `4cd67ad` (45638995417) pasó los siete.
- **ADR-0012:** su sección 8 es la de las pantallas de clave (#66) y la 9, la de la prueba e2e (#26, #65).
- Se cerraron solos, por `Closes`, los issues #19, #23, #24, #25, #26, #51 y #52. Siguen abiertos #20 (del usuario), #21 (`Refs`: la copia de seguridad está sin activar) y #27 (`Refs`; lo cierra el usuario tras publicar).

Antes de fusionar, cada rama apilada se actualizó con `main` (commits «Merge origin/main en …» en la historia de `main`), así que cada fusión entró al día con lo anterior.

Para el PR #61 (este borrador) rigen los mismos criterios que para los demás: diff revisado, CI en verde y criterios del issue verificados (`docs/PLAN_EJECUCION.md`, sección 4.5).

### B.2 Aplicar las migraciones en cada base existente

La API **no migra al arrancar**. En cada base que ya exista (desarrollo, Neon):

```
npm run db:migrate -w apps/api
```

o, desde la imagen: `node apps/api/dist/base-datos/migrar-cli.js` (README, sección «Despliegue en la nube y contenedor»). Las migraciones de esta versión son `0000` a `0008` y **todas están en `main`** (`4cd67ad`); la `0008` (cambio de clave) llegó con el PR #57. En una base que ya estaba al día con el `main` anterior (`4a4a1d1`, hasta la `0007`) es la única que falta; en una base vacía se aplican todas. Haz primero una copia de la base si tiene datos que importen (`docs/respaldo.md`).

### B.3 Comprobar `main` antes de publicar

1. `git switch main && git pull`.
2. `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e` y `npm run build` en verde (los mismos pasos del CI). Opcional, con Chromium instalado: `npm run test:navegador -w apps/web` (la prueba de navegador del PR #65; necesita `npm run build`, la base migrada y sembrada y `SEMILLA_CLAVE` exportada, y arranca su propio servidor: ver `apps/web/playwright.config.ts`).
3. Seguir «Cómo probarlo» con una base nueva y recorrer el [manual de usuario](manual-de-usuario.md) con los tres usuarios `*.demo`.
4. Confirmar que el CI de `main` esté en verde: `gh run list --branch main --limit 3` (al 25 de noviembre, `4cd67ad` pasó sus siete trabajos).

### B.4 Cerrar el borrador del CHANGELOG y del manual

- **Marcas del CHANGELOG:** las de lo que ya se fusionó pasaron de «(en revisión, PR #n)» a «(PR #n, fusionado)» en este mismo PR. Queda la del PR #61 (este archivo): tras fusionarlo, quitar esa marca y la mención en la leyenda del principio.
- Completar el manual: las secciones de carga, versión nueva y restaurar (#24) ya tienen capturas con datos ficticios (capturas 12 a 34, incluida la lista de varios candidatos de un duplicado), las de usuarios y auditoría (#25, PR #62) también (capturas 4 y 35 a 44, con la 39 y la 43 rehechas con la punta `8acb53f`) y las de clave (#51, PR #66 con la API del #57) también (capturas 45 a 51, de una rama local descartable): el manual tiene 51 en total, unos 5,1 MB. Hay unos pocos mensajes sueltos sin captura (por ejemplo, las validaciones de los formularios de clave y las pantallas de clave a 360 px); esos puntos siguen marcados [POR VERIFICAR] o [PENDIENTE]. Todos los PR de los que habla el manual ya están en `main` (el código de las pantallas no cambió al fusionar): falta confirmar los textos sin captura con las pantallas reales y revisar el manual con personas usuarias.
- Decidir quién redacta la versión final del manual: [POR VERIFICAR] César (parte académica) o Juan (parte técnica). El borrador lo deben revisar los dos.
- **Versiones de `package.json`:** hoy son `0.0.0` en la raíz y en los paquetes. Este borrador no las cambia. [PROPUESTA] ponerlas en `2.0.0` en el mismo commit que prepara el tag, si se quiere que coincidan.
- Fusionar este PR (#61) con commit de fusión o con squash (es independiente de los demás).

### B.5 Crear el tag y el release

Solo después de B.1 a B.4, con `main` actualizado:

```
git switch main && git pull
git tag -a v2.0.0 -m "Faro v2.0.0"
git push origin v2.0.0
gh release create v2.0.0 --verify-tag --title "Faro · Gestión documental v2.0.0" --notes-file <archivo con la parte A de este documento>
```

El archivo de `--notes-file` debe contener **solo la parte A**, sin este encabezado ni la parte B. Si prefieres hacerlo desde la web de GitHub, usa **Releases → Draft a new release**, elige el tag y pega la parte A. Tras publicarlo, cierra el issue #27 a mano y mueve su tarjeta a «Hecho» (el borrador deja `Refs #27`, no `Closes`).

### B.6 Lo que sigue abierto después de publicar

Issue #20 (despliegue real, del usuario), #21 (`Refs`: la copia de seguridad existe pero está sin activar) y #27 (`Refs`; se cierra a mano tras publicar). Siguen pendientes, dentro de lo ya fusionado: el filtro de acciones de la pantalla Auditoría (faltan `ccd_importado`, `clave_cambiada` y `clave_restablecida`), la decisión sobre el texto técnico del acceso denegado por clave temporal, el comando de emergencia `restablecer-clave` para el único administrador que olvida su clave (ADR-0011, [POR VERIFICAR]), y los hallazgos de la revisión de seguridad interna H-03, H-06, H-10 e I-09, que no se tratan en esta versión [PENDIENTE]; más lo [POR VERIFICAR] de la parte A. Ninguno impide publicar si el usuario lo decide así; sí conviene decirlo en la sustentación.
