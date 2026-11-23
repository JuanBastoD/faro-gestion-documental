import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { ENTORNO } from '../config/config.module.js';
import type { Entorno } from '../config/entorno.js';
import { ALMACEN, type AlmacenArchivos } from './almacen-archivos.js';
import { AlmacenDisco } from './almacen-disco.js';
import { AlmacenS3 } from './almacen-s3.js';

// Desde src/almacen o dist/almacen, ../../ es apps/api. Una ruta relativa se cuenta desde ahí y no
// desde el directorio donde se lance el proceso: así la API y el script de huérfanos ven la misma carpeta.
const RAIZ_API = fileURLToPath(new URL('../../', import.meta.url));

/** Elige el adaptador según ALMACEN_TIPO. La validación del entorno ya garantizó las variables de S3. */
export function crearAlmacen(entorno: Entorno): AlmacenArchivos {
  if (entorno.ALMACEN_TIPO === 's3') {
    return new AlmacenS3({
      endpoint: entorno.S3_ENDPOINT!,
      region: entorno.S3_REGION,
      bucket: entorno.S3_BUCKET!,
      accessKey: entorno.S3_ACCESS_KEY!,
      secretKey: entorno.S3_SECRET_KEY!,
    });
  }
  return new AlmacenDisco(resolve(RAIZ_API, entorno.ALMACEN_RUTA));
}

@Global()
@Module({
  providers: [
    {
      provide: ALMACEN,
      inject: [ENTORNO],
      useFactory: (entorno: Entorno): AlmacenArchivos => crearAlmacen(entorno),
    },
  ],
  exports: [ALMACEN],
})
export class AlmacenModule implements OnApplicationShutdown {
  constructor(@Inject(ALMACEN) private readonly almacen: AlmacenArchivos) {}

  onApplicationShutdown(): void {
    if (this.almacen instanceof AlmacenS3) this.almacen.cerrar();
  }
}
