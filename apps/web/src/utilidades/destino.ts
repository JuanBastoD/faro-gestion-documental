/**
 * A dónde volver tras ingresar o tras cambiar la clave: la ruta que se guardó en el estado de la navegación (`desde`) o
 * `/documentos`. Solo rutas internas (empiezan con una sola barra): nunca una dirección de otro sitio.
 */
export function destinoSeguro(estado: unknown): string {
  const desde = typeof estado === 'object' && estado !== null && 'desde' in estado ? estado.desde : undefined;
  return typeof desde === 'string' && desde.startsWith('/') && !desde.startsWith('//') ? desde : '/documentos';
}
