# Despliegue de pruebas en la nube

- **Fecha:** 22 de noviembre de 2026
- **Issue:** #20 (parte autónoma; la parte que necesita cuentas es del usuario, secciones 2 a 9)
- **Qué es:** un despliegue **de pruebas** del prototipo de clase, con datos ficticios, para demostrarlo y probar con usuarios. **No es infraestructura institucional** y no sustituye el servidor ni la red de la entidad, que están fuera del alcance de este proyecto.
- **Etiquetas de certeza:** [CONFIRMADO] probado en este repositorio; [POR VERIFICAR] escrito con el conocimiento de la documentación oficial pero **no probado** porque requiere la cuenta de Google Cloud o de Neon; [SUPUESTO] razonable pero sin medir; [PENDIENTE] falta construirlo.

## 1. Qué se despliega y cuánto cuesta

```
Navegador ──HTTPS──▶ Cloud Run (imagen de la API) ──▶ Neon (PostgreSQL)
                          │
                          └──▶ Cloud Storage (PDF, bucket privado, por la API compatible con S3)
```

| Pieza | Servicio | Por qué |
|---|---|---|
| API | Google Cloud Run | Escala a cero: sin tráfico no hay instancia y no hay cargo por ella |
| Base de datos | Neon (PostgreSQL gestionado) | Plan gratuito; la API ya habla PostgreSQL estándar, sin extensiones |
| Archivos | Google Cloud Storage | La API usa el adaptador S3; Cloud Storage ofrece una API compatible (claves HMAC) |
| Imágenes | Artifact Registry | Dónde queda la imagen del contenedor |
| Secretos | Secret Manager | URL de la base y claves del almacén; nunca en el repositorio |

**Costos [POR VERIFICAR el día de desplegar, en las páginas oficiales de precios y cuotas gratuitas de Cloud Run, Cloud Storage, Artifact Registry, Secret Manager y Neon].** Cloud Run, Cloud Storage y Artifact Registry tienen cuota gratuita mensual, pero **exigen una cuenta de facturación con tarjeta aunque no se llegue a cobrar nada**, y la cuota gratuita de Cloud Storage y de Cloud Run depende de la región (las de Estados Unidos suelen estar incluidas; São Paulo, la más cercana a Colombia, no). Por eso se propone `us-central1` [POR VERIFICAR]. [SUPUESTO] Con datos ficticios y pocas decenas de PDF el uso queda muy por debajo de las cuotas; no está medido.

**Regla de este guion: la alerta de presupuesto va ANTES del primer despliegue** (sección 3).

## 2. Lo que necesitas antes de empezar

- Una cuenta de Google con una **cuenta de facturación** (tarjeta) y la herramienta `gcloud` instalada (<https://cloud.google.com/sdk/docs/install>) y autenticada: `gcloud auth login`.
- Una cuenta de Neon (<https://neon.tech>), con GitHub o correo.
- Permisos de administrador en el repositorio de GitHub para crear **variables** del repositorio.
- 30 a 45 minutos [SUPUESTO].

Los comandos usan variables de shell. Cámbialas una vez y pega todo lo demás (Git Bash, macOS o Linux; en PowerShell se escribe `$PROYECTO="..."`):

```bash
export PROYECTO="faro-pruebas-XXXXXX"        # único en todo Google Cloud: cámbialo
export REGION="us-central1"                  # [POR VERIFICAR] región con cuota gratuita
export BUCKET="${PROYECTO}-documentos"       # también único en todo Google Cloud
export REPO_GITHUB="JuanBastoD/faro-gestion-documental"
```

## 3. Proyecto, facturación y alerta de presupuesto (antes de todo lo demás) [POR VERIFICAR]

```bash
gcloud projects create "$PROYECTO" --name="Faro pruebas"
gcloud billing accounts list                  # copia el ID de tu cuenta de facturación
export CUENTA_FACTURACION="XXXXXX-XXXXXX-XXXXXX"
gcloud billing projects link "$PROYECTO" --billing-account="$CUENTA_FACTURACION"
gcloud config set project "$PROYECTO"
```

**Alerta de presupuesto** (consola: Facturación → Presupuestos y alertas → Crear presupuesto). Pon un monto bajo (por ejemplo 5 USD) y alertas al 50 %, 90 % y 100 % hacia tu correo. Una alerta **avisa, no corta el gasto**: si te llega, entra y borra lo que corresponda (sección 12). Comprueba que quedó creada antes de seguir.

Activa las APIs:

```bash
gcloud services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com \
  iamcredentials.googleapis.com sts.googleapis.com storage.googleapis.com cloudresourcemanager.googleapis.com
```

## 4. Base de datos en Neon [POR VERIFICAR]

1. Crea un proyecto en Neon. Región: la más cercana a `us-central1` que ofrezca (por ejemplo AWS us-east-2) [SUPUESTO: la latencia entre nubes es aceptable para un prototipo; no está medida].
2. Copia la **cadena de conexión directa** (la que **no** dice `-pooler`), con `sslmode=require`: `postgresql://usuario:clave@host/base?sslmode=require`. La directa es la correcta para las migraciones.
3. [POR VERIFICAR] **El plan gratuito de Neon limita el almacenamiento** (consulta el límite vigente en su página de precios). La tabla `versiones` guarda el texto normalizado de cada PDF para la búsqueda y los duplicados (ADR-006 y ADR-007): con muchos documentos largos puede crecer rápido. Para el prototipo con datos ficticios no debería importar.
4. [POR VERIFICAR] Neon **suspende el cómputo sin uso** y el primer acceso después de un rato tarda más. La API espera hasta 3 segundos por una conexión (`base-datos.module.ts`); si ves errores en la primera petición, ese valor es lo primero que se revisa.

Guarda la cadena como secreto:

```bash
printf '%s' 'postgresql://usuario:clave@host/base?sslmode=require' | gcloud secrets create faro-database-url --data-file=-
```

(Pega la cadena real entre comillas simples. No la escribas en un archivo del repositorio ni en un mensaje.)

## 5. Archivos: Cloud Storage con acceso privado [POR VERIFICAR]

```bash
gcloud storage buckets create "gs://$BUCKET" --location="$REGION" \
  --uniform-bucket-level-access --public-access-prevention

# Cuenta de servicio con la que corre la API: solo puede leer y escribir objetos de ESTE bucket.
gcloud iam service-accounts create faro-api-runtime --display-name="Faro API (ejecución)"
export SA_EJECUCION="faro-api-runtime@${PROYECTO}.iam.gserviceaccount.com"
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
  --member="serviceAccount:$SA_EJECUCION" --role="roles/storage.objectUser"

# Claves HMAC para la API compatible con S3. El secreto se muestra UNA sola vez: cópialo ya.
gcloud storage hmac create "$SA_EJECUCION"
```

Guarda las dos claves como secretos (pega lo que mostró el comando anterior):

```bash
printf '%s' 'ID_DE_ACCESO' | gcloud secrets create faro-s3-access-key --data-file=-
printf '%s' 'SECRETO'      | gcloud secrets create faro-s3-secret-key --data-file=-
for s in faro-database-url faro-s3-access-key faro-s3-secret-key; do
  gcloud secrets add-iam-policy-binding "$s" \
    --member="serviceAccount:$SA_EJECUCION" --role="roles/secretmanager.secretAccessor"
done
```

[POR VERIFICAR] **El adaptador S3 de la API nunca se ha probado contra Cloud Storage** (solo contra RustFS, que sí se probó). El cliente ya se configuró pensando en esto (`forcePathStyle: true` y `requestChecksumCalculation`/`responseChecksumValidation` en `'WHEN_REQUIRED'`, en `apps/api/src/almacen/almacen-s3.ts`, porque las sumas de verificación automáticas de las versiones recientes del SDK no las aceptan todos los almacenes compatibles), pero eso se probó con RustFS y no con Cloud Storage. Si la primera carga falla, mira primero el mensaje de error de esa llamada. `S3_REGION=auto` es lo que Cloud Storage espera en su modo compatible [POR VERIFICAR].

## 6. Imágenes: Artifact Registry [POR VERIFICAR]

```bash
gcloud artifacts repositories create faro --repository-format=docker --location="$REGION" \
  --description="Imágenes de Faro"
```

## 7. Autenticación de GitHub sin llaves (Workload Identity Federation) [POR VERIFICAR]

El flujo de despliegue **no usa llaves JSON**: GitHub pide un token de corta vida y Google lo cambia por permisos de una cuenta de servicio, **solo para este repositorio y solo desde la rama `main`**.

```bash
export NUMERO_PROYECTO="$(gcloud projects describe "$PROYECTO" --format='value(projectNumber)')"

# Cuenta que despliega: puede publicar en Cloud Run, subir imágenes y "actuar como" la de ejecución.
gcloud iam service-accounts create faro-deployer --display-name="Faro (despliegue desde GitHub)"
export SA_DESPLIEGUE="faro-deployer@${PROYECTO}.iam.gserviceaccount.com"
for rol in roles/run.admin roles/artifactregistry.writer; do
  gcloud projects add-iam-policy-binding "$PROYECTO" --member="serviceAccount:$SA_DESPLIEGUE" --role="$rol"
done
gcloud iam service-accounts add-iam-policy-binding "$SA_EJECUCION" \
  --member="serviceAccount:$SA_DESPLIEGUE" --role="roles/iam.serviceAccountUser"

# Quién puede usar esa cuenta: solo ejecuciones de ESTE repositorio, y solo desde main.
gcloud iam workload-identity-pools create github --location=global --display-name="GitHub Actions"
gcloud iam workload-identity-pools providers create-oidc faro-repo --location=global \
  --workload-identity-pool=github --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
  --attribute-condition="assertion.repository=='${REPO_GITHUB}' && assertion.ref=='refs/heads/main'"
gcloud iam service-accounts add-iam-policy-binding "$SA_DESPLIEGUE" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${NUMERO_PROYECTO}/locations/global/workloadIdentityPools/github/attribute.repository/${REPO_GITHUB}"

echo "Proveedor: projects/${NUMERO_PROYECTO}/locations/global/workloadIdentityPools/github/providers/faro-repo"
```

Como el repositorio es público, la condición `assertion.repository == ...` es lo que impide que otro repositorio (o un fork) use esa cuenta. Si el despliegue falla con un error de autenticación, lo primero que se revisa es que lo lanzaste desde `main` (la condición lo exige).

## 8. Variables del repositorio (no son secretos)

En GitHub: **Settings → Secrets and variables → Actions → pestaña Variables → New repository variable**. Crea estas seis; el flujo `.github/workflows/deploy.yml` **no hace nada hasta que existan todas**:

| Variable | Valor |
|---|---|
| `GCP_PROJECT_ID` | el valor de `$PROYECTO` |
| `GCP_REGION` | el valor de `$REGION` |
| `GCP_WIF_PROVIDER` | la línea `projects/…/providers/faro-repo` que imprimió el último comando de la sección 7 |
| `GCP_DEPLOYER_SA` | el valor de `$SA_DESPLIEGUE` |
| `GCP_RUNTIME_SA` | el valor de `$SA_EJECUCION` |
| `GCS_BUCKET` | el valor de `$BUCKET` |

No hay ningún secreto de GitHub que crear: los secretos de la aplicación viven en Secret Manager.

## 9. Primer despliegue

Con todo lo anterior (y los PR de #8 a #20 fusionados a `main`, porque el despliegue sale de `main`):

1. En GitHub: **Actions → Despliegue → Run workflow** (rama `main`, «Aplicar las migraciones» marcado).
2. El flujo construye la imagen, la sube a Artifact Registry, **migra la base** (un trabajo de Cloud Run con la misma imagen), publica el servicio `faro-api` y comprueba `/health`. Al final imprime la dirección.
3. **Crea el primer administrador** (la API no trae usuarios, y `db:seed` se niega a correr en producción). Una sola vez, con la misma imagen:

   ```bash
   printf '%s' 'UNA-CLAVE-LARGA-DE-12-O-MAS-CARACTERES' | gcloud secrets create faro-admin-clave --data-file=-
   gcloud secrets add-iam-policy-binding faro-admin-clave \
     --member="serviceAccount:$SA_EJECUCION" --role="roles/secretmanager.secretAccessor"
   IMAGEN="$(gcloud run services describe faro-api --region "$REGION" --format 'value(spec.template.spec.containers[0].image)')"
   gcloud run jobs deploy faro-admin --image "$IMAGEN" --region "$REGION" --service-account "$SA_EJECUCION" \
     --command node --args apps/api/dist/semilla/crear-administrador.js \
     --set-env-vars "ADMIN_USUARIO=admin.faro,ADMIN_NOMBRE=Administrador" \
     --set-secrets "DATABASE_URL=faro-database-url:latest,ADMIN_CLAVE=faro-admin-clave:latest" \
     --max-retries 0
   gcloud run jobs execute faro-admin --region "$REGION" --wait
   ```

   Después ingresa con ese usuario y crea a los demás con `POST /usuarios`. [PENDIENTE] Hoy nadie puede cambiar su clave (ADR-008, sección 4): usa una clave que estés dispuesto a conservar, o desactiva la cuenta y crea otra.
4. **[PENDIENTE #19] El cuadro de clasificación llega vacío** y sin él no se puede cargar ningún documento (cada documento va en una subserie). La importación por CSV (#19) todavía no existe. Mientras tanto, para una demostración, el cuadro ficticio de `apps/api/src/semilla/ccd-demo.ts` se puede cargar con SQL directo contra Neon; **no uses `db:seed`: crea usuarios de demostración con una clave conocida**.

## 10. Comprobar

```bash
URL="$(gcloud run services describe faro-api --region "$REGION" --format 'value(status.url)')"
curl "$URL/health"                    # {"estado":"ok", ...} con "base": "ok"
curl -i "$URL/documentos"             # 401: nada se ve sin sesión
```

Luego, en el navegador o con `curl`: ingresar, crear un usuario, cargar un PDF ficticio, descargarlo y buscarlo. [POR VERIFICAR] Reinicia el servicio (`gcloud run services update faro-api --region "$REGION" --update-labels reinicio=$(date +%s)`) y comprueba que la sesión, el documento y el archivo siguen ahí (es la prueba 7 de aceptación, ahora contra la nube).

## 11. Lo que SÍ se probó en local [CONFIRMADO]

La imagen se construyó y se probó el 22 de noviembre de 2026 contra el PostgreSQL y el almacén S3 (RustFS) del Compose, en una base descartable:

- `docker build -f apps/api/Dockerfile -t faro-api .` (contexto: la raíz del repositorio). Imagen de 403 MB, tres etapas, proceso como usuario `node` (uid 1000), sin pruebas, sin fuentes, sin `.env`, sin `drizzle-kit`.
- Migrar con el comando de la imagen (`node apps/api/dist/base-datos/migrar-cli.js`); repetirlo es inocuo.
- Crear el primer administrador (`node apps/api/dist/semilla/crear-administrador.js`); una clave corta se rechaza sin repetirla, y repetir el comando no cambia nada.
- Arrancar la API con `ALMACEN_TIPO=s3`: `/health` responde con la base en `ok`, sin sesión `/documentos` es 401.
- Ingresar, **cargar un PDF, descargarlo byte por byte idéntico, buscarlo por texto**, y **reiniciar el contenedor**: la sesión, el documento y el archivo siguen.
- El `HEALTHCHECK` de Docker pasa a `healthy`; cero líneas `ERROR` en el registro.
- El trabajo `imagen` del CI repite la construcción y las comprobaciones de seguridad en cada PR.

Lo que **no** se probó: Cloud Run, Neon, Cloud Storage, Secret Manager, Artifact Registry, Workload Identity Federation ni el flujo `deploy.yml` (todo lo marcado [POR VERIFICAR] arriba).

## 12. Borrar todo (si algo sale mal o termina el curso)

```bash
gcloud run services delete faro-api --region "$REGION"
gcloud run jobs delete faro-migrar --region "$REGION"; gcloud run jobs delete faro-admin --region "$REGION"
gcloud storage rm -r "gs://$BUCKET"
gcloud artifacts repositories delete faro --location="$REGION"
# o, lo más simple: borrar el proyecto entero y con él todo lo anterior
gcloud projects delete "$PROYECTO"
```

En Neon: borra el proyecto desde su consola. Desvincular la facturación del proyecto también detiene los cargos.

## 13. Decisiones y límites de este despliegue

- **La API no migra al arrancar** (dejó de ser una pregunta abierta): con varias instancias y arranques en frío, migrar es un paso aparte, antes de publicar. Lo hace el flujo con un trabajo de Cloud Run y falla el despliegue si la migración falla. Descartado: migrar en el arranque (dos instancias migrando a la vez, y un arranque en frío más lento).
- **Memoria de 1 GiB y máximo de 2 instancias** [SUPUESTO]: la API recibe PDF de hasta 20 MB en memoria y extrae su texto. No está medido; si el servicio se reinicia por falta de memoria, súbela. Dos instancias como máximo mantienen acotado el costo.
- **`--allow-unauthenticated`**: es una aplicación web pública con su propio ingreso; Cloud Run no pone otro. Todo lo demás exige sesión.
- **La interfaz todavía no existe** (V2-M4). Hoy se despliega solo la API; cuando exista, la propia API la sirve compilada, en un solo contenedor y un solo origen (sin CORS ni cookies entre sitios). [PENDIENTE] Sin límite de intentos de ingreso ni protección CSRF hasta #18: no publiques la dirección ampliamente antes de eso.
- **La imagen base se fija por etiqueta (`node:24-slim`), no por huella.** Recibe actualizaciones de seguridad al reconstruir; la contrapartida es que la construcción no es bit a bit reproducible. [PROPUESTA] Fijarla por huella si se activa un actualizador automático.
