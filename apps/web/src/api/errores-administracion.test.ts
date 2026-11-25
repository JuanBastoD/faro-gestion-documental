import { describe, expect, it } from 'vitest';
import { ErrorApi } from './cliente';
import { traducirErrorDeAuditoria, traducirErrorDeUsuarios, traducirProblemaDeAlta } from './errores-administracion';

function error(estado: number, extra: { codigo?: string; problemas?: string[]; esperaSeg?: number; cuerpo?: unknown } = {}) {
  return new ErrorApi({ estado, mensaje: 'texto crudo del servidor en inglés', ...extra });
}

describe('traducirProblemaDeAlta', () => {
  it.each([
    ['usuario: es obligatorio', 'usuario', 'El nombre de usuario es obligatorio.'],
    ['nombre: es obligatorio', 'nombre', 'El nombre es obligatorio.'],
    ['clave: es obligatoria', 'clave', 'La clave es obligatoria.'],
    ['nombre: no puede pasar de 120 caracteres', 'nombre', 'El nombre no puede pasar de 120 caracteres.'],
    ['clave: no puede pasar de 256 caracteres', 'clave', 'La clave no puede pasar de 256 caracteres.'],
    ['clave: debe tener al menos 12 caracteres', 'clave', 'La clave debe tener al menos 12 caracteres.'],
    ['clave: no puede ser solo espacios', 'clave', 'La clave no puede ser solo espacios.'],
    ['rol: debe ser uno de: administrador, editor, consulta', 'rol', 'Elige uno de los tres roles de la lista.'],
  ])('%s', (problema, campo, frase) => {
    expect(traducirProblemaDeAlta(problema)).toEqual({ campo, frase });
  });

  it('el formato del nombre de usuario se explica con las palabras de la pantalla', () => {
    const { campo, frase } = traducirProblemaDeAlta(
      'usuario: de 3 a 64 caracteres: minúsculas, números, punto, guion y guion bajo, empezando con letra o número',
    );
    expect(campo).toBe('usuario');
    expect(frase).toMatch(/^El nombre de usuario debe tener de 3 a 64 caracteres/);
  });

  it('un problema sin campo conocido (campos no admitidos) cae en una frase genérica', () => {
    expect(traducirProblemaDeAlta('campos no admitidos: admin')).toEqual({
      campo: undefined,
      frase: 'Algún dato no es válido. Revísalo e inténtalo de nuevo.',
    });
  });
});

describe('traducirErrorDeUsuarios', () => {
  it('un error que no es de la API es un mensaje genérico', () => {
    expect(traducirErrorDeUsuarios(new Error('x'), 'alta').mensaje).toBe('Ocurrió un error inesperado. Intenta de nuevo.');
  });

  it('sin red: dice que se revise la lista antes de repetir un alta o un cambio, pero no al listar', () => {
    expect(traducirErrorDeUsuarios(error(0), 'alta').mensaje).toMatch(/No se pudo conectar.*puede que el usuario sí se haya creado/);
    expect(traducirErrorDeUsuarios(error(0), 'cambio').mensaje).toMatch(/puede que el cambio sí se haya hecho/);
    expect(traducirErrorDeUsuarios(error(0), 'listar').mensaje).toBe('No se pudo conectar con el servidor. Revisa tu conexión e intenta de nuevo.');
  });

  it('401: la sesión terminó', () => {
    expect(traducirErrorDeUsuarios(error(401), 'cambio').mensaje).toBe('Tu sesión terminó. Ingresa de nuevo para continuar.');
  });

  it('429 usa Retry-After, y sin él pide esperar unos minutos', () => {
    expect(traducirErrorDeUsuarios(error(429, { esperaSeg: 90 }), 'alta').mensaje).toMatch(/Intenta de nuevo en 2 minutos/);
    expect(traducirErrorDeUsuarios(error(429), 'alta').mensaje).toMatch(/Espera unos minutos/);
  });

  it('5xx: un texto propio, sin mostrar lo que diga el servidor', () => {
    const traducido = traducirErrorDeUsuarios(error(503), 'listar');
    expect(traducido.mensaje).toBe('El servidor tuvo un problema. Intenta de nuevo en unos minutos.');
    expect(traducido.mensaje).not.toMatch(/crudo/);
  });

  it('un estado raro dice cuál fue', () => {
    expect(traducirErrorDeUsuarios(error(418), 'alta').mensaje).toMatch(/código 418/);
  });

  describe('400', () => {
    it('en el alta reparte los problemas por campo y arma el mensaje con las frases traducidas', () => {
      const traducido = traducirErrorDeUsuarios(
        error(400, { problemas: ['clave: debe tener al menos 12 caracteres', 'nombre: es obligatorio'] }),
        'alta',
      );
      expect(traducido.campos).toEqual({ clave: 'La clave debe tener al menos 12 caracteres.', nombre: 'El nombre es obligatorio.' });
      expect(traducido.mensaje).toBe('La clave debe tener al menos 12 caracteres. El nombre es obligatorio.');
      expect(traducido.mensaje).not.toMatch(/crudo/);
    });

    it('en el alta, un 400 sin lista de problemas es un mensaje genérico', () => {
      expect(traducirErrorDeUsuarios(error(400), 'alta')).toMatchObject({
        mensaje: 'Algún dato no es válido. Revísalo e inténtalo de nuevo.',
        campos: {},
      });
    });

    it('al cambiar, no hay campos que señalar', () => {
      const traducido = traducirErrorDeUsuarios(error(400, { problemas: ['indica al menos rol o activo'] }), 'cambio');
      expect(traducido.campos).toEqual({});
      expect(traducido.mensaje).toMatch(/El cambio no es válido/);
    });
  });

  describe('403', () => {
    it('de rol: dice que solo los administradores pueden y pide volver a leer la sesión', () => {
      const traducido = traducirErrorDeUsuarios(error(403), 'alta');
      expect(traducido.mensaje).toMatch(/solo los administradores pueden/);
      expect(traducido.rolDesactualizado).toBe(true);
    });

    it('de origen: no es un problema de rol y no pide volver a leer la sesión', () => {
      const traducido = traducirErrorDeUsuarios(error(403, { codigo: 'origen_no_permitido' }), 'alta');
      expect(traducido.mensaje).toMatch(/desde un sitio que el servidor no reconoce/);
      expect(traducido.rolDesactualizado).toBe(false);
    });

    it('con la clave temporal (cambio_de_clave_requerido): no es de rol y no pide volver a leer la sesión', () => {
      const traducido = traducirErrorDeUsuarios(error(403, { codigo: 'cambio_de_clave_requerido' }), 'cambio');
      expect(traducido.mensaje).toMatch(/Tu clave es temporal/);
      expect(traducido.mensaje).not.toMatch(/administradores/);
      expect(traducido.rolDesactualizado).toBe(false);
    });
  });

  it('404 al cambiar: el usuario ya no existe', () => {
    expect(traducirErrorDeUsuarios(error(404), 'cambio').mensaje).toMatch(/El usuario ya no existe/);
  });

  describe('409', () => {
    it('ultimo_administrador explica qué hacer antes', () => {
      const traducido = traducirErrorDeUsuarios(error(409, { codigo: 'ultimo_administrador' }), 'cambio');
      expect(traducido.mensaje).toMatch(/último administrador activo/);
      expect(traducido.mensaje).toMatch(/Antes crea o reactiva a otro administrador/);
      expect(traducido.campos).toEqual({});
    });

    it('usuario_existente cita el nombre y apunta al campo del usuario', () => {
      const traducido = traducirErrorDeUsuarios(error(409, { codigo: 'usuario_existente' }), 'alta', { usuario: 'ana.demo' });
      expect(traducido.campos.usuario).toBe('Ya existe un usuario llamado «ana.demo». Elige otro nombre de usuario.');
      expect(traducido.mensaje).toBe(traducido.campos.usuario);
    });

    it('usuario_existente sin el nombre en el contexto sigue siendo claro', () => {
      expect(traducirErrorDeUsuarios(error(409, { codigo: 'usuario_existente' }), 'alta').campos.usuario).toBe(
        'Ya existe un usuario con ese nombre. Elige otro nombre de usuario.',
      );
    });

    it('un 409 desconocido pide actualizar la lista', () => {
      expect(traducirErrorDeUsuarios(error(409), 'cambio').mensaje).toMatch(/Actualiza la lista/);
    });
  });

  it('ningún mensaje repite el texto crudo del servidor', () => {
    for (const estado of [0, 400, 401, 403, 404, 409, 418, 429, 500]) {
      for (const operacion of ['listar', 'alta', 'cambio'] as const) {
        expect(traducirErrorDeUsuarios(error(estado), operacion).mensaje).not.toMatch(/crudo/);
      }
    }
  });
});

describe('traducirErrorDeAuditoria', () => {
  it('un 400 con la lista de problemas da una frase por filtro y no cita nombres de parámetros', () => {
    const texto = traducirErrorDeAuditoria(
      error(400, { problemas: ['accion: accion no es válida', 'documentoId: documentoId debe ser un número', 'accion: accion no es válida'] }),
    );
    expect(texto).toBe('La acción elegida no es válida. El número de documento no es válido. Revisa los filtros o quítalos e inténtalo de nuevo.');
  });

  it('el orden de las fechas, que la API ata a «desde», se dice con las dos fechas', () => {
    expect(traducirErrorDeAuditoria(error(400, { problemas: ['desde: desde no puede ser posterior a hasta'] }))).toMatch(
      /La fecha «desde» no puede ser posterior a «hasta»\./,
    );
  });

  it('un 400 sin lista, o con un parámetro desconocido, cae en una frase genérica', () => {
    expect(traducirErrorDeAuditoria(error(400))).toMatch(/Algún filtro no es válido/);
    expect(traducirErrorDeAuditoria(error(400, { problemas: ['otra: cosa'] }))).toMatch(/Algún filtro no es válido/);
  });

  it('403 de rol y de origen se distinguen', () => {
    expect(traducirErrorDeAuditoria(error(403))).toMatch(/solo los administradores pueden/);
    expect(traducirErrorDeAuditoria(error(403, { codigo: 'origen_no_permitido' }))).toMatch(/desde un sitio que el servidor no reconoce/);
  });

  it('sin red, 401, 429 y 5xx usan los textos comunes', () => {
    expect(traducirErrorDeAuditoria(error(0))).toMatch(/No se pudo conectar/);
    expect(traducirErrorDeAuditoria(error(401))).toBe('Tu sesión terminó. Ingresa de nuevo para continuar.');
    expect(traducirErrorDeAuditoria(error(429, { esperaSeg: 30 }))).toMatch(/Intenta de nuevo en 30 segundos/);
    expect(traducirErrorDeAuditoria(error(500))).toBe('El servidor tuvo un problema. Intenta de nuevo en unos minutos.');
  });

  it('ningún mensaje repite el texto crudo del servidor', () => {
    for (const estado of [0, 400, 401, 403, 404, 409, 418, 429, 500]) {
      expect(traducirErrorDeAuditoria(error(estado))).not.toMatch(/crudo/);
    }
  });

  it('algo que no es un ErrorApi es un mensaje genérico', () => {
    expect(traducirErrorDeAuditoria('x')).toBe('Ocurrió un error inesperado. Intenta de nuevo.');
  });
});
