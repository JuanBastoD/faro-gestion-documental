import type { Logger } from '@nestjs/common';
import type { AlmacenArchivos } from '../almacen/almacen-archivos.js';
import type { DocumentosRepository } from './documentos.repository.js';

/**
 * Deshace el guardado de un objeto tras una transacción fallida: lo borra, salvo que otra versión
 * ya lo use. Un fallo aquí no tapa el error original; se registra y el objeto queda como huérfano
 * (`npm run almacen:huerfanos` lo encuentra).
 */
export async function compensarObjeto(
  clave: string,
  repositorio: Pick<DocumentosRepository, 'objetoReferenciado'>,
  almacen: Pick<AlmacenArchivos, 'borrar'>,
  logger: Pick<Logger, 'error'>,
): Promise<void> {
  try {
    if (!(await repositorio.objetoReferenciado(clave))) {
      await almacen.borrar(clave);
    }
  } catch (error) {
    logger.error(
      `No se pudo limpiar el objeto ${clave} tras una operación fallida; quedará como huérfano: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
