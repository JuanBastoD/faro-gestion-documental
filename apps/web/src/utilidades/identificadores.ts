/** El identificador de la URL como número, o `undefined` si no es un entero positivo (entonces no se llama a la API). */
export function leerId(valor: string | undefined): number | undefined {
  if (valor === undefined || !/^\d{1,10}$/.test(valor)) return undefined;
  const id = Number(valor);
  return id >= 1 ? id : undefined;
}
