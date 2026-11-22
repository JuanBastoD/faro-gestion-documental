import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Carga el .env de la raíz del repositorio si existe (desarrollo local).
 * No pisa variables que ya estén definidas, y en la nube (donde no hay archivo)
 * no hace nada: allí las variables las inyecta la plataforma.
 * Devuelve true si cargó un archivo.
 */
export function cargarEnvLocal(): boolean {
  // Desde src/config o dist/config: ../../../../ es la raíz del repositorio.
  const ruta = fileURLToPath(new URL('../../../../.env', import.meta.url));
  if (!existsSync(ruta)) {
    return false;
  }
  process.loadEnvFile(ruta);
  return true;
}
