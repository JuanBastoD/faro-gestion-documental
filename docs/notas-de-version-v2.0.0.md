# Notas de la versión v2.0.0 (BORRADOR, sin publicar)

- **Estado:** [PROPUESTA] borrador para el issue #27. Este archivo **no es un release**: el tag `v2.0.0` y el release en GitHub los crea el usuario (ver la parte B).
- **Fecha de redacción:** 23 de noviembre de 2026. No lleva fecha de publicación.
- **Fuentes:** [`CHANGELOG.md`](../CHANGELOG.md) (cada ítem con su issue y su PR), los ADR 0001 a 0013 en [`docs/adr/`](adr/README.md), [`README.md`](../README.md) y [`docs/PLAN_EJECUCION.md`](PLAN_EJECUCION.md).
- **Etiquetas de certeza:** [CONFIRMADO], [POR VERIFICAR], [SUPUESTO], [PROPUESTA], [DESCARTADO].
- **Estructura:** la **parte A** es el texto para pegar en el release. La **parte B** son los pasos del usuario y no va en el release.

> **Antes de publicar:** el texto de la parte A describe el sistema **con todos los PR de la lista de la parte B ya fusionados en `main`**. Hoy (23 de noviembre) los PR #53 a #60 siguen abiertos (ninguno es ya un borrador, salvo este, el #61). Si alguno no se fusiona, hay que quitar su viñeta de la parte A y su ítem del `CHANGELOG.md`.

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
- **Auditoría que no se puede alterar:** el ingreso, las cargas, las versiones, las descargas, las decisiones ante un duplicado, los cambios de usuarios y los accesos denegados quedan registrados. El administrador la consulta con filtros; los eventos no se editan ni se borran ni por SQL.
- **Administración de usuarios y de claves:** crear usuarios, cambiar su rol, desactivarlos (nunca se borran) y restablecer una clave; cada persona puede cambiar la suya. El sistema no deja sin administradores activos. **Hoy se hace por la API:** la pantalla de usuarios y la de cambio de clave son [POR VERIFICAR] (ver abajo).
- **Interfaz web** que se usa desde el computador o el celular (desde 360 px de ancho): ingreso, listado, detalle con historial y descarga, carga de documentos y de versiones nuevas, y restaurar versiones.
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
- **Pantallas pendientes:** administración de usuarios y auditoría en la interfaz (issue #25) y cambio de clave en la interfaz. Se usan por la API.
- **Recuperación de clave:** no hay «olvidé mi clave» por correo. Un administrador restablece la de otra persona; **si el único administrador olvida la suya, no hay salida por la API** [POR VERIFICAR] un comando de emergencia con acceso a la base.
- **Cifras:** esta versión no publica cifras de rendimiento ni de ahorro. Las que existan sobre el re-escaneo siguen [SIMULADO] hasta medir la línea base real.

#### Lo que no incluye

Permisos por documento o por serie (todo usuario con sesión ve todos los documentos), digitalización del archivo histórico, TRD y TVD definitivas, servidor, red e infraestructura de la entidad, OCR propio, borrado o edición de documentos y versiones, e integración con SIA o SECOP. La lista completa está en `CHANGELOG.md`, sección «Lo que NO incluye v2.0.0».

Registro completo de cambios: [`CHANGELOG.md`](../CHANGELOG.md).

---

## Parte B. Pasos del usuario para publicar (no van en el release)

Todo esto lo hace el usuario. Ningún agente fusiona PR, crea el tag ni publica el release. Si el usuario quiere que un agente lo haga, tiene que decirlo de forma explícita y por alcance (cada autorización cubre solo lo que nombra).

### B.1 Revisar y fusionar los PR en orden

Orden sugerido por la coordinación del trabajo del 22 y 23 de noviembre: **#60, #56, #53, #55, #57, #54, #58**, y **#59** donde el usuario decida. Fusiona cada uno con **«Create a merge commit»**, no con squash (decisión 20 de `docs/PLAN_EJECUCION.md`: con squash, los PR apilados dan conflictos). Espera a que el CI de `main` termine antes de la siguiente fusión.

| Orden | PR | Qué es | Base | Nota |
|---|---|---|---|---|
| 1 | #60 | CI: `secretos` escanea desde `HEAD` | `main` | Quita el contagio de hallazgos entre ramas; conviene primero |
| 2 | #56 | CI: `tsc --noEmit` | `main` | Issue #52 |
| 3 | #53 | Copia de seguridad (#21) | `main` | `Refs #21`: la activación es del usuario |
| 4 | #55 | Importar el cuadro desde CSV (#19) | `main` | ADR-0010 |
| 5 | #57 | Cambio y restablecimiento de clave (#51) | `feat/19-importar-ccd` | Apilado sobre #55; migración `0008`. Al fusionar #55, GitHub reenfoca #57 a `main` |
| 6 | #54 | Interfaz: ingreso, listado y detalle (#23) | `main` | ADR-0012; toca `package-lock.json` |
| 7 | #58 | Interfaz: carga, versión y duplicado (#24) | `feat/23-web-listado` | Listo para revisar y apilado sobre #54: va después de #54. Su `secretos` salió en rojo por el contagio que corrige #60 [POR VERIFICAR al volver a ejecutarlo] |
| — | #59 | Arreglo del bloqueo mutuo de usuarios | `main` | Listo para revisar y sin issue; el usuario decide si entra. Mismo caso de `secretos` que #58 |
| al final | #61 | Este borrador (#27) | `main` | Ver B.4 |

Por cada PR: diff revisado, CI en verde y criterios del issue verificados (`docs/PLAN_EJECUCION.md`, sección 4.5). Los PR #53 y #55 tocan los mismos archivos de documentación que otros (`README.md`, `docs/adr/README.md`, `docs/despliegue.md`): si GitHub avisa de conflicto, se resuelve conservando las dos partes. [SUPUESTO] los conflictos son triviales porque cada carril añadió su parte en un bloque aparte.

### B.2 Aplicar las migraciones en cada base existente

La API **no migra al arrancar**. En cada base que ya exista (desarrollo, Neon):

```
npm run db:migrate -w apps/api
```

o, desde la imagen: `node apps/api/dist/base-datos/migrar-cli.js` (README, sección «Despliegue en la nube y contenedor»). Las migraciones de esta versión son `0000` a `0008`. `main` (`4a4a1d1`) trae de la `0000` a la `0007`; la `0008` (cambio de clave) llega con el PR #57, así que en una base que ya estaba al día con `main` es la única que falta. En una base vacía se aplican todas. Haz primero una copia de la base si tiene datos que importen (`docs/respaldo.md`, tras fusionar #53).

### B.3 Comprobar `main` antes de publicar

1. `git switch main && git pull`.
2. `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e` y `npm run build` en verde (los mismos pasos del CI).
3. Seguir «Cómo probarlo» con una base nueva y recorrer el [manual de usuario](manual-de-usuario.md) con los tres usuarios `*.demo`.
4. Confirmar que el CI de `main` esté en verde: `gh run list --branch main --limit 3`.

### B.4 Cerrar el borrador del CHANGELOG y del manual

- **Quitar las marcas «(en revisión, PR #n)»** de `CHANGELOG.md` de lo que ya se fusionó (hoy están en #19, #51, #21, #23, #24, #52 y en el PR #60 y el #59), y revisar que lo que no se fusionó quede fuera.
- Completar el manual: las secciones de carga, versión nueva y restaurar (#24) ya tienen capturas con datos ficticios (capturas 11 a 30). Faltan las de administración de usuarios y auditoría (#25), el cambio de clave (rama `feat/51-web-clave`, sección 11 vacía), la lista de varios candidatos de un duplicado y dos mensajes sueltos; esos puntos siguen marcados [POR VERIFICAR]. Confirmar los textos con las pantallas reales cuando se fusionen.
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

Issues #20 (despliegue real, del usuario), #25 (administración en la interfaz, *could*) y #26 (prueba e2e, *could*), más lo [POR VERIFICAR] de la parte A. Ninguno impide publicar si el usuario lo decide así; sí conviene decirlo en la sustentación.
