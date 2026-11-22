/** Tamaño máximo de un PDF: 20 MB. */
export const TAMANO_MAXIMO_BYTES = 20 * 1024 * 1024;

/** Un PDF empieza con `%PDF-`. Se mira el contenido, no la extensión ni el tipo que declara el navegador. */
export function esPdf(datos: Buffer): boolean {
  return datos.length > 5 && datos.subarray(0, 5).toString('latin1') === '%PDF-';
}

/**
 * Multer entrega el nombre del archivo leído como latin1 aunque el navegador lo envíe en UTF-8
 * ("interventoría.pdf" llega como "interventorÃ­a.pdf"). Se deshace ese error; si el resultado
 * no es UTF-8 válido, el nombre ya estaba bien y se deja como llegó.
 */
export function decodificarNombre(nombreRecibido: string): string {
  const recodificado = Buffer.from(nombreRecibido, 'latin1').toString('utf8');
  return recodificado.includes('\uFFFD') ? nombreRecibido : recodificado;
}

/**
 * Deja un nombre seguro para guardar y mostrar: sin carpetas, sin caracteres de control
 * y de largo acotado. Si queda vacío usa "documento.pdf".
 */
export function limpiarNombre(nombre: string): string {
  const soloNombre = nombre.split(/[\\/]/).pop() ?? '';
  const limpio = soloNombre
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  if (limpio === '') return 'documento.pdf';
  if (limpio.length <= 150) return limpio;
  const punto = limpio.lastIndexOf('.');
  const extension = punto > 0 && limpio.length - punto <= 10 ? limpio.slice(punto) : '';
  return limpio.slice(0, 150 - extension.length) + extension;
}

/** Cabecera Content-Disposition con nombre de respaldo ASCII y el nombre real en UTF-8 (RFC 5987). */
export function contenidoDisposicion(nombre: string): string {
  const ascii = nombre.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const utf8 = encodeURIComponent(nombre).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}
