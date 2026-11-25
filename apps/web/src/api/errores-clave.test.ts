import { describe, expect, it } from 'vitest';
import { ErrorApi } from './cliente';
import { TEXTO_CLAVE_ACTUAL_INCORRECTA, traducirErrorDeClave, traducirProblemaDeClave } from './errores-clave';

function error(estado: number, extra: { codigo?: string; problemas?: string[]; esperaSeg?: number; mensaje?: string } = {}) {
  return new ErrorApi({ estado, mensaje: extra.mensaje ?? 'texto crudo del servidor', ...extra });
}

describe('traducirProblemaDeClave', () => {
  it.each([
    ['claveNueva: debe tener al menos 12 caracteres', 'claveNueva', 'La clave nueva debe tener al menos 12 caracteres.'],
    ['claveNueva: no puede pasar de 256 caracteres', 'claveNueva', 'La clave nueva no puede pasar de 256 caracteres.'],
    ['claveNueva: no puede ser solo espacios', 'claveNueva', 'La clave nueva no puede ser solo espacios.'],
    ['claveNueva: debe ser distinta de la clave actual', 'claveNueva', 'La clave nueva debe ser distinta de la actual.'],
    ['claveActual: es obligatoria', 'claveActual', 'La clave actual es obligatoria.'],
    ['clave: debe tener al menos 12 caracteres', 'clave', 'La clave temporal debe tener al menos 12 caracteres.'],
    ['clave: no puede ser solo espacios', 'clave', 'La clave temporal no puede ser solo espacios.'],
  ])('«%s» apunta a %s', (problema, campo, frase) => {
    expect(traducirProblemaDeClave(problema)).toEqual({ campo, frase });
  });

  it('un campo que no conoce o un texto sin campo cae en el mensaje genérico, sin campo', () => {
    expect(traducirProblemaDeClave('otroCampo: algo').campo).toBeUndefined();
    expect(traducirProblemaDeClave('algo raro').campo).toBeUndefined();
  });

  it('un problema conocido de un campo que no se reconoce no se pierde: «no es válida»', () => {
    expect(traducirProblemaDeClave('claveNueva: raro')).toEqual({ campo: 'claveNueva', frase: 'La clave nueva no es válida.' });
  });
});

describe('traducirErrorDeClave: cambiar la propia clave', () => {
  it('400 clave_actual_incorrecta es un error del campo «clave actual» y no una sesión vencida', () => {
    const r = traducirErrorDeClave(error(400, { codigo: 'clave_actual_incorrecta', mensaje: 'La clave actual no es correcta' }), 'cambiar');
    expect(r.campos).toEqual({ claveActual: TEXTO_CLAVE_ACTUAL_INCORRECTA });
    expect(r.mensaje).toBe(TEXTO_CLAVE_ACTUAL_INCORRECTA);
    expect(r.mensaje).not.toMatch(/sesión/);
    expect(r.rolDesactualizado).toBe(false);
  });

  it('400 con problemas se reparte por campo, en español', () => {
    const r = traducirErrorDeClave(
      error(400, { problemas: ['claveNueva: debe tener al menos 12 caracteres', 'claveActual: es obligatoria'] }),
      'cambiar',
    );
    expect(r.campos.claveNueva).toBe('La clave nueva debe tener al menos 12 caracteres.');
    expect(r.campos.claveActual).toBe('La clave actual es obligatoria.');
    expect(r.mensaje).not.toMatch(/texto crudo/);
  });

  it('400 sin problemas ni código: mensaje genérico, sin campos', () => {
    const r = traducirErrorDeClave(error(400), 'cambiar');
    expect(r.campos).toEqual({});
    expect(r.mensaje).toMatch(/Algún dato no es válido/);
  });

  it('429 con Retry-After dice cuánto esperar y avisa que tampoco se podrá ingresar', () => {
    const r = traducirErrorDeClave(error(429, { esperaSeg: 900, codigo: 'demasiados_intentos' }), 'cambiar');
    expect(r.mensaje).toMatch(/Intenta de nuevo en 15 minutos/);
    expect(r.mensaje).toMatch(/tampoco podrás ingresar/);
  });

  it('429 sin Retry-After sigue siendo claro', () => {
    expect(traducirErrorDeClave(error(429), 'cambiar').mensaje).toMatch(/Espera unos minutos/);
  });

  it('409 conflicto_de_clave dice que otra petición cambió la clave y que se reintente', () => {
    const r = traducirErrorDeClave(error(409, { codigo: 'conflicto_de_clave' }), 'cambiar');
    expect(r.mensaje).toMatch(/Otra petición cambió tu clave al mismo tiempo/);
    expect(r.mensaje).toMatch(/ingresa con la clave nueva/);
  });

  it('401 es la sesión que terminó', () => {
    expect(traducirErrorDeClave(error(401), 'cambiar').mensaje).toMatch(/Tu sesión terminó/);
  });

  it('403 cambio_de_clave_requerido no es de permisos y no pide volver a leer el rol', () => {
    const r = traducirErrorDeClave(error(403, { codigo: 'cambio_de_clave_requerido' }), 'restablecer');
    expect(r.mensaje).toMatch(/Tu clave es temporal/);
    expect(r.rolDesactualizado).toBe(false);
  });

  it('403 de origen no es de rol', () => {
    const r = traducirErrorDeClave(error(403, { codigo: 'origen_no_permitido' }), 'cambiar');
    expect(r.mensaje).toMatch(/sitio que el servidor no reconoce/);
    expect(r.rolDesactualizado).toBe(false);
  });

  it('sin red avisa que, si la clave sí se cambió, la anterior ya no sirve', () => {
    const r = traducirErrorDeClave(error(0), 'cambiar');
    expect(r.mensaje).toMatch(/No se pudo conectar/);
    expect(r.mensaje).toMatch(/la anterior ya no sirve/);
  });

  it('5xx usa el texto propio, no el del servidor', () => {
    const r = traducirErrorDeClave(error(503), 'cambiar');
    expect(r.mensaje).toMatch(/El servidor tuvo un problema/);
    expect(r.mensaje).not.toMatch(/texto crudo/);
  });

  it('un error que no es de la API es «inesperado»', () => {
    expect(traducirErrorDeClave(new Error('x'), 'cambiar').mensaje).toMatch(/error inesperado/);
  });

  it('ningún mensaje repite una clave: los textos no dependen de lo que se escribió', () => {
    const textos = [400, 401, 403, 404, 409, 429, 500, 0].map((estado) => traducirErrorDeClave(error(estado), 'cambiar').mensaje);
    for (const texto of textos) expect(texto).not.toMatch(/xxxx|clave-demo/);
  });
});

describe('traducirErrorDeClave: restablecer la clave de otra persona', () => {
  it('403 de rol pide volver a leer la sesión y explica que solo administran los administradores', () => {
    const r = traducirErrorDeClave(error(403), 'restablecer');
    expect(r.mensaje).toMatch(/solo los administradores pueden/);
    expect(r.rolDesactualizado).toBe(true);
  });

  it('404 cita a la persona', () => {
    expect(traducirErrorDeClave(error(404), 'restablecer', { nombre: 'Ana Demo' }).mensaje).toMatch(/Ana Demo ya no existe/);
    expect(traducirErrorDeClave(error(404), 'restablecer').mensaje).toMatch(/El usuario ya no existe/);
  });

  it('409 restablecer_clave_propia manda a «Cambiar mi clave»', () => {
    const r = traducirErrorDeClave(error(409, { codigo: 'restablecer_clave_propia' }), 'restablecer');
    expect(r.mensaje).toMatch(/Cambiar mi clave/);
  });

  it('400 con el campo «clave» apunta a la clave temporal', () => {
    const r = traducirErrorDeClave(error(400, { problemas: ['clave: debe tener al menos 12 caracteres'] }), 'restablecer');
    expect(r.campos.clave).toBe('La clave temporal debe tener al menos 12 caracteres.');
  });

  it('429 es de peticiones, no de la clave actual', () => {
    const r = traducirErrorDeClave(error(429, { esperaSeg: 30 }), 'restablecer');
    expect(r.mensaje).toMatch(/Intenta de nuevo en 30 segundos/);
    expect(r.mensaje).not.toMatch(/clave actual/);
  });

  it('sin red dice que la última clave que se restablezca es la que vale', () => {
    expect(traducirErrorDeClave(error(0), 'restablecer').mensaje).toMatch(/vale la última/);
  });

  it('un código raro (418) dice qué no se pudo hacer, con el código', () => {
    expect(traducirErrorDeClave(error(418), 'restablecer').mensaje).toMatch(/No se pudo restablecer la clave \(código 418\)/);
  });
});
