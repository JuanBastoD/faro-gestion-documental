# syntax=docker/dockerfile:1
#
# Imagen de la API de Faro. El contexto de construcción es la RAÍZ del repositorio:
#
#   docker build -f apps/api/Dockerfile -t faro-api .
#
# Cuatro etapas para que la imagen final traiga solo lo necesario para ejecutar (sin compilador,
# sin dependencias de desarrollo, sin código fuente, sin pruebas) y corra sin permisos de administrador.
# La imagen incluye la interfaz web ya compilada (apps/web/dist): la API la sirve en /app/ (ADR-012).
#
# Cada etapa que ejecuta `npm ci` copia los package.json de TODOS los workspaces que figuran en el
# package-lock.json: sin el de apps/web, npm ci vería el lockfile desincronizado.

# --- 1. Compilar la API (necesita las dependencias de desarrollo) -------------------------------
FROM node:24-slim AS construccion
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace apps/api --include-workspace-root
COPY apps/api/ apps/api/
RUN npm run build --workspace apps/api

# --- 2. Compilar la interfaz web (Vite; solo queda la carpeta dist) ----------------------------
FROM node:24-slim AS interfaz
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace apps/web --include-workspace-root
COPY apps/web/ apps/web/
RUN npm run build --workspace apps/web

# --- 3. Dependencias de ejecución --------------------------------------------------------------
FROM node:24-slim AS dependencias
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace apps/api --omit=dev

# --- 4. Imagen final ------------------------------------------------------------------------------
FROM node:24-slim
# HOST=0.0.0.0 para que escuche fuera del contenedor. Cloud Run inyecta su propio PORT (8080).
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
WORKDIR /app
COPY --from=dependencias /app/node_modules ./node_modules
COPY --from=dependencias /app/package.json ./package.json
COPY apps/api/package.json ./apps/api/package.json
COPY --from=construccion /app/apps/api/dist ./apps/api/dist
# La interfaz compilada va donde la API la busca por defecto (apps/api/dist/interfaz/../../../web/dist).
COPY --from=interfaz /app/apps/web/dist ./apps/web/dist
# Las migraciones SQL se leen en tiempo de ejecución (ver base-datos/migrar.ts).
COPY apps/api/drizzle ./apps/api/drizzle

# El usuario `node` ya viene en la imagen oficial. Con el almacén en disco (solo desarrollo) la carpeta
# `almacen-local` se crea bajo apps/api: se deja escribible para ese usuario.
RUN mkdir -p /app/apps/api/almacen-local && chown -R node:node /app/apps/api/almacen-local
USER node

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

# Por defecto arranca la API. Otros comandos de la misma imagen (migrar, crear el primer administrador):
#   node apps/api/dist/base-datos/migrar-cli.js
#   node apps/api/dist/semilla/crear-administrador.js
CMD ["node", "apps/api/dist/main.js"]
