# ADR-013: Copia de seguridad con pg_dump hacia un bucket privado y restauración solo a una base nueva

- **Fecha:** 22 de noviembre de 2026
- **Estado:** Aceptada al fusionar este documento
- **Issue:** #21
- **Relacionada con:** ADR-004 (almacén de archivos), ADR-009 (sin secretos en el repositorio), `docs/despliegue.md`, `docs/respaldo.md`, `docs/PLAN_EJECUCION.md` (decisión 18)
- **Etiquetas de certeza:** [CONFIRMADO] construido y probado en el repositorio; [PROPUESTA] decidido pero aún no activado ni medido; [POR VERIFICAR] falta un dato o una prueba que requiere cuentas; [SUPUESTO] razonable pero sin medir; [DESCARTADO] se consideró y no se hizo.

## 1. Contexto

El entorno de pruebas de la nube (#20) guardará usuarios, documentos, versiones y la auditoría en una base de Neon, y los PDF en Cloud Storage. Sin copia de seguridad, perder la base (un error, un borrado, el fin de un plan gratuito) obliga a empezar de cero y el entorno de pruebas deja de ser confiable (criterio del issue #21).

Restricciones:

1. **El repositorio es público.** Un respaldo contiene toda la base: usuarios con su clave en hash, el texto de los documentos y la auditoría. No puede viajar por ningún canal que un tercero pueda leer, y GitHub Actions deja descargar los **artefactos** de una ejecución a cualquiera cuando el repositorio es público.
2. **No hay secretos en el repositorio** (ADR-009). La cadena de conexión de la base es un secreto.
3. **Mismas versiones en todas partes.** El Compose, el CI y la base de Neon deberían ser PostgreSQL 17; `pg_dump` se niega a respaldar un servidor más nuevo que él.
4. **Crear cuentas y secretos no es algo que este trabajo pueda hacer.** Activar la copia programada depende del usuario.

## 2. Decisión

### 2.1 `pg_dump -Fc` con la imagen `postgres:17-alpine` fijada por huella, en un script [CONFIRMADO]

`infra/respaldo/respaldar.sh` ejecuta `pg_dump --format=custom` dentro de la imagen `postgres:17-alpine` (la misma versión mayor que el Compose y el CI), **fijada por huella (digest)** en `infra/respaldo/comun.sh` y no por etiqueta, porque esa imagen recibe la clave de la base (se puede reemplazar con `RESPALDO_IMAGEN`, también por huella). Todo se configura por variables de entorno. El script:

- **No imprime la cadena de conexión ni la clave, y la clave no es argumento de ningún proceso:** descompone `RESPALDO_DATABASE_URL` (decodifica la clave con codificación porcentual y se niega, con un mensaje fijo que no repite la cadena, ante cualquier forma que no entienda) y entrega al contenedor `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD` y `PGDATABASE` por el entorno, que `docker` recibe solo por nombre. Si `pg_dump` falla, el mensaje de error pasa por un filtro que tapa la cadena y la clave. Queda visible en `docker inspect` para quien ya controle Docker en ese equipo (`docs/respaldo.md`).
- **No deja archivos a medias:** escribe a un archivo aparte y lo renombra solo al verificarlo, con permisos solo para su dueño.
- **Verifica el respaldo:** no vacío y legible con `pg_restore --list`, con al menos una tabla.
- **Falla con un mensaje útil** si el servidor es más nuevo que `pg_dump`.

Formato personalizado (`-Fc`) porque está comprimido, `pg_restore` puede listarlo y restaurarlo selectivamente y en una sola transacción, y conserva los dueños para decidir al restaurar.

### 2.2 Restaurar solo a una base nueva [CONFIRMADO]

`infra/respaldo/restaurar.sh` crea la base de destino y se niega (código 1) con `faro`, `postgres`, `template0`, `template1`, cualquier nombre terminado en `_test`, la base de origen del respaldo, nombres con mayúsculas o símbolos y **cualquier base que ya exista**. Restaura con `--single-transaction --exit-on-error` (todo o nada) y `--no-owner --no-privileges` (para pasar de Neon a otro servidor), comprueba que `auditoria` conserva su disparador y muestra las filas por tabla, con comparación opcional contra la base original. *Motivo:* la restauración es la operación peligrosa del ciclo (un destino equivocado sobrescribe datos vivos); se prefiere un procedimiento que no pueda dañar nada sobre uno flexible. Recuperar la base de producción es crear una base nueva, comprobarla y **apuntar la aplicación a ella**, no pisar la anterior.

### 2.3 Copia programada a un bucket privado, sin llaves y sin artefactos [PROPUESTA, inactiva]

`.github/workflows/respaldo.yml` corre cada día (cron) y a demanda; **se omite mientras no existan las variables del repositorio** (mismo patrón que `deploy.yml`). Se autentica con Workload Identity Federation (sin llaves JSON), usa una **cuenta de servicio propia que solo puede crear objetos** en un bucket de respaldos privado y distinto del de los documentos, y sube el archivo con `gcloud storage cp`. **Nunca sube el respaldo como artefacto de Actions ni lo imprime.** La retención (30 días) la aplica una regla de ciclo de vida del bucket, no el flujo, para que el flujo no necesite permiso de borrar. La cadena de conexión de Neon es el secreto `RESPALDO_DATABASE_URL`, que crea el usuario; [PROPUESTA] con un rol de solo lectura.

### 2.4 El CI repite el ciclo en cada PR [CONFIRMADO]

El trabajo `respaldo` de `ci.yml` revisa los scripts (`bash -n` y shellcheck v0.11.0, imagen fijada por huella), prueba el analizador de la conexión (`probar-conexion.sh`), migra y siembra una base efímera, la respalda, la restaura en una base nueva, compara los conteos y comprueba las negativas (`faro`, `postgres`, `faro_test` y una base que ya existe). *Motivo:* una guía de restauración probada una sola vez se pudre; una migración futura (por ejemplo, una extensión) puede romper la restauración sin que nadie lo note hasta el día del desastre.

## 3. Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| **[DESCARTADO] Guardar el respaldo como artefacto de GitHub Actions** | En un repositorio público cualquiera puede descargar los artefactos de una ejecución: sería publicar toda la base. Es la razón principal de este ADR y de la decisión 18 del plan |
| **[DESCARTADO] Solo respaldo manual** | Depende de que alguien se acuerde; el criterio del issue pide una copia programada. Se conserva el comando manual como respaldo del respaldo (y es lo que queda si el plan se recorta, sección 7 del plan) |
| **[DESCARTADO] `pg_dump` en formato plano (SQL)** | Pesa más (sin comprimir), no se puede listar su contenido para verificarlo ni restaurar de forma selectiva, y se restaura con `psql`, que por omisión sigue adelante tras un error y deja la base a medias salvo que se le pidan explícitamente las garantías |
| **[DESCARTADO] Depender solo de la ventana de restauración de Neon** | [POR VERIFICAR] el plan gratuito conserva pocas horas de historial, y vive en la misma cuenta y el mismo proveedor que la base: no cubre perder la cuenta ni un error descubierto días después |
| **[DESCARTADO] Leer la cadena de conexión desde Secret Manager dentro del flujo** (un solo lugar para el secreto) | Daría a la cuenta del respaldo acceso al secreto de la aplicación (que es el dueño de la base); se quiere que el flujo use una credencial de solo lectura y una cuenta que solo crea objetos. La contrapartida (dos copias del secreto, en GitHub y en Secret Manager) se acepta |
| **[DESCARTADO] Una cuenta de servicio con permisos de escritura y borrado en el bucket** | Un flujo comprometido podría borrar los respaldos. Con `objectCreator` solo puede agregar |
| **[DESCARTADO] Restaurar sobre la base existente (`--clean`)** | Un destino equivocado destruye datos vivos. Restaurar siempre en una base nueva y apuntar la aplicación hacia ella es igual de rápido y reversible |
| **[DESCARTADO] Instalar `pg_dump` en el runner o en el equipo** | La imagen fija la versión, no hay nada que instalar y funciona igual en Windows, Linux y GitHub |
| **[DESCARTADO] Pasar la cadena de conexión completa a `pg_dump --dbname=...`** (la primera versión, hasta `ebe36e2`) | La clave quedaba como argumento del proceso `pg_dump` dentro del contenedor y cualquier usuario del equipo la veía con `ps` (hallazgo H-04 de la revisión de seguridad; comprobado con un control en `docs/respaldo.md`, sección 7). Se reemplazó por `PGPASSWORD` y las demás `PG*` |
| **[DESCARTADO] Dejar la imagen por etiqueta (`postgres:17-alpine`)** | Una etiqueta se puede mover; la imagen ve la clave de la base (hallazgo H-05). Se fija por huella y se actualiza con un PR (`docs/respaldo.md`, sección 3) |
| **[DESCARTADO] Un archivo de contraseñas (`PGPASSFILE`) o un volumen montado con la clave** | Habría que escribir la clave en un archivo del equipo, y el diseño actual no deja ningún archivo con ella; el entorno por nombre de variable basta |

## 4. Consecuencias

- **Lo que mejora:** hay un procedimiento de respaldo y restauración probado de punta a punta (sección 7 de `docs/respaldo.md`) y vigilado por el CI; la copia programada, cuando se active, no puede exponer la base por el repositorio ni borrar sus propias copias.
- **Hay que activarlo** (lo único que falta para cerrar el criterio «copia programada de la base»): bucket, cuenta de servicio, variables y secreto, por el usuario (`docs/respaldo.md`, sección 8). Por eso el PR usa `Refs #21` y no `Closes #21`.
- **Los PDF no se respaldan** (están en el almacén, no en la base). [PROPUESTA] versionado de objetos del bucket de documentos antes de que importen.
- **La copia de la base y los PDF se restauran por separado.** Tras restaurar una copia vieja, los PDF cargados después quedan sin referencia y `almacen:huerfanos -- --borrar` los borraría (`docs/respaldo.md`, sección 6). Por eso **no se agregó una limpieza programada de huérfanos** (el ADR-004 dejaba abierta esa posibilidad para #21): [PENDIENTE] decidirla aparte, con esa advertencia.
- **Riesgo de versión:** si la base de Neon queda en PostgreSQL 18 (valor por omisión de los proyectos nuevos, [POR VERIFICAR]), la imagen 17 se negará; se resuelve con `RESPALDO_IMAGEN` o eligiendo la 17 al crear el proyecto (`docs/despliegue.md`, sección 4).
- **Riesgo de una sola persona:** el secreto, el bucket y la cuenta dependen del dueño del repositorio (`docs/respaldo.md`, sección 9).
- **Una imagen fijada no se actualiza sola:** la huella se revisa con un PR cada cierto tiempo [PROPUESTA] (`docs/respaldo.md`, sección 3).
- **Pendientes de la revisión de seguridad, sin hacer** (gravedad baja, `docs/respaldo.md`, sección 10): H-06 [PROPUESTA, lo decide el usuario] pasar `RESPALDO_DATABASE_URL` a un *Environment* limitado a `main`; I-08 [PROPUESTA] guardar y comprobar la huella SHA-256 del volcado antes de restaurar.

## 5. [POR VERIFICAR]

1. **Que `respaldo.yml` funcione de punta a punta** en la cuenta real: la federación, el rol `objectCreator` con `gcloud storage cp` (si pide `storage.objects.get` o `list`, se usa `objectUser` sobre ese bucket), y el cron.
2. **La versión de PostgreSQL de Neon** (la documentación pública, leída el 22 de noviembre de 2026 sin cuenta, dice que los proyectos nuevos usan la 18) y que la API y las migraciones funcionen en ella.
3. **Que `pg_dump` funcione con un rol de solo lectura en Neon** y con la cadena directa (sin `-pooler`).
4. **Los límites del plan gratuito de Neon** (almacenamiento, ventana de restauración de unas 6 horas según la documentación pública, horas de cómputo que gasta el respaldo diario) y las cuotas gratuitas de Cloud Storage para 30 copias.
5. **El período del borrado temporal por omisión de Cloud Storage** en los buckets nuevos.
6. **Que GitHub no desactive el flujo programado** (60 días sin actividad en un repositorio público).
7. **Frecuencia y retención** (diaria y 30 días) [PROPUESTA]: se ajustan cuando haya datos que importen.

## 6. Referencias

- `docs/respaldo.md` (guía, prueba de restauración y pasos del usuario), `infra/respaldo/`, `.github/workflows/respaldo.yml` y el trabajo `respaldo` de `.github/workflows/ci.yml`.
- `docs/PLAN_EJECUCION.md`, sección 5 (#21) y decisión 18; `docs/despliegue.md`; ADR-004 y ADR-009.
- Issue #21 y su PR.
