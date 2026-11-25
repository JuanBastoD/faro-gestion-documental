import { describe, expect, it } from 'vitest';
import { cuerpoDeExacto, cuerpoDeProbable } from '../pruebas/carga';
import { ErrorApi } from './cliente';
import { leerConflictoDeDuplicado, traducirError, traducirProblema, type Operacion } from './errores';

function error(estado: number, cuerpo?: unknown, extra: { codigo?: string; problemas?: string[]; esperaSeg?: number; mensaje?: string } = {}) {
  const objeto = typeof cuerpo === 'object' && cuerpo !== null ? (cuerpo as Record<string, unknown>) : {};
  return new ErrorApi({
    estado,
    mensaje: extra.mensaje ?? (typeof objeto.message === 'string' ? objeto.message : 'mensaje crudo en inglés'),
    codigo: extra.codigo ?? (typeof objeto.codigo === 'string' ? objeto.codigo : undefined),
    problemas: extra.problemas,
    esperaSeg: extra.esperaSeg,
    cuerpo,
  });
}

describe('traducción de problemas de validación (400)', () => {
  it.each([
    ['titulo: es obligatorio', 'titulo', 'El título es obligatorio.'],
    ['titulo: no puede pasar de 200 caracteres', 'titulo', 'El título no puede pasar de 200 caracteres.'],
    ['expediente: es obligatorio', 'expediente', 'El expediente es obligatorio.'],
    ['serieId: es obligatoria', 'serieId', 'La subserie es obligatoria.'],
    ['fechaDocumento: debe tener el formato AAAA-MM-DD', 'fechaDocumento', 'La fecha del documento debe tener el formato AAAA-MM-DD.'],
    ['fechaDocumento: no es una fecha válida', 'fechaDocumento', 'La fecha del documento no es una fecha válida.'],
    ['motivo: es obligatorio: explica qué cambió en esta versión', 'motivo', 'El motivo es obligatorio: explica qué cambió en esta versión.'],
    ['motivo: no puede pasar de 300 caracteres', 'motivo', 'El motivo no puede pasar de 300 caracteres.'],
  ])('«%s» se dice en español y apunta al campo', (problema, campo, frase) => {
    expect(traducirProblema(problema)).toEqual({ campo, frase });
  });

  it('reescribe los textos que citan parámetros de la API', () => {
    expect(traducirProblema('motivo: es obligatorio con decision=nueva_version: explica qué cambió').frase).toBe(
      'El motivo es obligatorio: explica qué cambió en esta versión.',
    );
    expect(traducirProblema('documentoId: es obligatorio con decision=nueva_version').frase).toBe(
      'Falta elegir el documento al que se agrega la versión.',
    );
    expect(traducirProblema('justificacion: es obligatoria con decision=documento_distinto: explica por qué no es un duplicado').frase).toBe(
      'La justificación es obligatoria: explica por qué no es un duplicado.',
    );
    expect(traducirProblema('justificacion: solo aplica con decision=documento_distinto').frase).toBe(
      'La justificación no corresponde a la decisión elegida.',
    );
    expect(traducirProblema('decision: debe ser nueva_version o documento_distinto').frase).toBe(
      'La decisión no es válida: elige una de las opciones.',
    );
  });

  it('un problema que no es de un campo conocido da el texto genérico, sin repetir lo técnico', () => {
    const { campo, frase } = traducirProblema('cuerpo: Unexpected token { in JSON');
    expect(campo).toBeUndefined();
    expect(frase).not.toContain('JSON');
  });
});

describe('traducción de errores por código de estado', () => {
  const operaciones: Operacion[] = ['carga', 'version', 'restauracion'];

  it('400 con problemas: junta las frases y señala los campos', () => {
    const traducido = traducirError(
      error(400, { message: 'Datos inválidos' }, { problemas: ['titulo: es obligatorio', 'fechaDocumento: no es una fecha válida'] }),
      'carga',
    );
    expect(traducido.mensaje).toBe('El título es obligatorio. La fecha del documento no es una fecha válida.');
    expect(traducido.campos).toEqual({
      titulo: 'El título es obligatorio.',
      fechaDocumento: 'La fecha del documento no es una fecha válida.',
    });
  });

  it('400 sin archivo: lo pide y señala el campo del archivo', () => {
    const traducido = traducirError(error(400, { message: 'Falta el archivo PDF (campo "archivo")' }), 'carga');
    expect(traducido.mensaje).toBe('Falta el archivo: elige el PDF que quieres subir.');
    expect(Object.keys(traducido.campos)).toEqual(['archivo']);
  });

  it('400 sin explicación: texto genérico, nunca el crudo', () => {
    const traducido = traducirError(error(400, { message: 'Unexpected field' }), 'carga');
    expect(traducido.mensaje).toMatch(/Revísalo/);
    expect(traducido.mensaje).not.toContain('Unexpected');
  });

  it.each(operaciones)('401 (%s): dice que la sesión terminó', (operacion) => {
    expect(traducirError(error(401, { message: 'Unauthorized' }), operacion).mensaje).toMatch(/sesión terminó/);
  });

  it.each(operaciones)('403 (%s): explica quién puede cargar', (operacion) => {
    expect(traducirError(error(403, { message: 'Forbidden resource' }), operacion).mensaje).toMatch(/administradores y los editores/);
  });

  it('403 por origen no permitido: no culpa al rol', () => {
    const traducido = traducirError(error(403, { message: 'x', codigo: 'origen_no_permitido' }), 'carga');
    expect(traducido.mensaje).toMatch(/dirección habitual/);
    expect(traducido.mensaje).not.toMatch(/permiso/);
  });

  it.each(operaciones)('403 cambio_de_clave_requerido (%s): la clave es temporal, no es un problema de permisos', (operacion) => {
    const traducido = traducirError(error(403, { message: 'x', codigo: 'cambio_de_clave_requerido' }), operacion);
    expect(traducido.mensaje).toMatch(/Tu clave es temporal/);
    expect(traducido.mensaje).not.toMatch(/permiso|administradores/);
  });

  it('404 cambia según lo que se hacía', () => {
    expect(traducirError(error(404), 'carga').mensaje).toMatch(/subserie o el documento elegido/);
    expect(traducirError(error(404), 'version').mensaje).toMatch(/El documento ya no existe/);
    expect(traducirError(error(404), 'restauracion').mensaje).toMatch(/versión o el documento ya no existe/);
  });

  it('413: dice el máximo y qué hacer, y señala el archivo', () => {
    const traducido = traducirError(error(413, { message: 'File too large', statusCode: 413 }), 'carga');
    expect(traducido.mensaje).toMatch(/más de 20 MB/);
    expect(traducido.mensaje).toMatch(/divídelo/);
    expect(traducido.mensaje).not.toContain('File too large');
    expect(traducido.campos.archivo).toBeDefined();
  });

  it('415: dice que no es un PDF y qué hacer, y señala el archivo', () => {
    const traducido = traducirError(error(415, { message: 'El archivo no es un PDF' }), 'version');
    expect(traducido.mensaje).toMatch(/no es un PDF válido/);
    expect(traducido.mensaje).toMatch(/otro tipo de archivo/);
    expect(traducido.campos.archivo).toBeDefined();
  });

  it('422: una serie que no admite documentos señala la subserie', () => {
    const traducido = traducirError(error(422, { message: 'La serie 100 no admite documentos' }), 'carga');
    expect(traducido.mensaje).toMatch(/Elige una subserie/);
    expect(traducido.campos.serieId).toBeDefined();
  });

  it('429 usa la espera de Retry-After', () => {
    expect(traducirError(error(429, undefined, { esperaSeg: 900 }), 'carga').mensaje).toBe(
      'Hiciste demasiadas peticiones en poco tiempo. Intenta de nuevo en 15 minutos.',
    );
    expect(traducirError(error(429), 'carga').mensaje).toMatch(/Espera unos minutos/);
  });

  it('sin red (estado 0): dice que no se pudo conectar y que no se duplicará lo que ya llegó', () => {
    expect(traducirError(error(0), 'carga').mensaje).toMatch(/No se pudo conectar/);
    expect(traducirError(error(0), 'carga').mensaje).toMatch(/no se duplicará/);
    expect(traducirError(error(0), 'restauracion').mensaje).toMatch(/mira el historial/);
  });

  it('5xx: texto propio, sin el cuerpo del servidor', () => {
    const traducido = traducirError(error(500, { message: 'Internal server error: relation "documentos" does not exist' }), 'carga');
    expect(traducido.mensaje).toBe('El servidor tuvo un problema. Intenta de nuevo en unos minutos.');
  });

  it('un 4xx que no se conoce: da el código y a quién avisar, no el texto crudo', () => {
    const traducido = traducirError(error(418, { message: 'I am a teapot' }), 'carga');
    expect(traducido.mensaje).toContain('418');
    expect(traducido.mensaje).not.toContain('teapot');
  });

  it('algo que no es un ErrorApi: mensaje inesperado', () => {
    expect(traducirError(new TypeError('x is undefined'), 'carga').mensaje).toBe('Ocurrió un error inesperado. Intenta de nuevo.');
  });
});

describe('traducción de los 409', () => {
  it('duplicado exacto: dice dónde está el documento y por qué no se puede', () => {
    const mensaje = traducirError(error(409, cuerpoDeExacto()), 'carga').mensaje;
    expect(mensaje).toContain('«Contrato de obra 7»');
    expect(mensaje).toContain('versión 2');
    expect(mensaje).toMatch(/no se puede cargar dos veces/);
  });

  it('duplicado probable: pide decidir', () => {
    expect(traducirError(error(409, cuerpoDeProbable()), 'carga').mensaje).toMatch(/decide qué hacer/);
  });

  it('versión nueva con contenido repetido: dice con cuál versión coincide', () => {
    const cuerpo = { statusCode: 409, message: 'Este contenido ya está en la versión 2 del documento', versionExistente: 2 };
    const mensaje = traducirError(error(409, cuerpo), 'version').mensaje;
    expect(mensaje).toMatch(/mismo contenido que la versión 2/);
    expect(mensaje).toMatch(/no se creó ninguna versión nueva/);
  });

  it('versión repetida sin número (carrera entre dos cargas): sigue siendo claro', () => {
    const cuerpo = { statusCode: 409, message: 'x', versionExistente: null };
    expect(traducirError(error(409, cuerpo), 'version').mensaje).toMatch(/ya está en una versión del documento/);
  });

  it('carga como versión de un documento elegido con contenido repetido', () => {
    const cuerpo = { statusCode: 409, message: 'x', versionExistente: 1 };
    expect(traducirError(error(409, cuerpo), 'carga').mensaje).toMatch(/versión 1 del documento/);
  });

  it('restaurar una versión cuyo contenido ya es el de la vigente', () => {
    const cuerpo = { statusCode: 409, message: 'La versión vigente (3) ya tiene el mismo contenido que la 1', versionVigente: 3 };
    expect(traducirError(error(409, cuerpo), 'restauracion').mensaje).toBe(
      'La versión vigente (3) ya tiene el mismo contenido que la versión que quieres restaurar, así que no se creó ninguna versión nueva.',
    );
  });

  it('un 409 desconocido: pide recargar', () => {
    expect(traducirError(error(409, { message: 'otra cosa' }), 'carga').mensaje).toMatch(/Recarga la página/);
  });
});

describe('lectura del aviso de duplicado', () => {
  it('reconoce el duplicado exacto con su ubicación', () => {
    const conflicto = leerConflictoDeDuplicado(error(409, cuerpoDeExacto()));
    expect(conflicto).toMatchObject({ codigo: 'duplicado_exacto', existente: { documentoId: 7, version: 2 } });
  });

  it('reconoce el duplicado probable con umbral y candidatos', () => {
    const conflicto = leerConflictoDeDuplicado(error(409, cuerpoDeProbable()));
    expect(conflicto).toMatchObject({ codigo: 'duplicado_probable', umbral: 0.8 });
    expect(conflicto?.codigo === 'duplicado_probable' && conflicto.candidatos[0].similitud).toBe(0.93);
  });

  it.each([
    ['un 409 sin código', error(409, { message: 'x' })],
    ['un código de duplicado sin candidatos', error(409, { ...cuerpoDeProbable(), candidatos: [] })],
    ['un candidato mal formado', error(409, { ...cuerpoDeProbable(), candidatos: [{ documentoId: '7' }] })],
    ['un exacto sin ubicación', error(409, { codigo: 'duplicado_exacto', existente: {} })],
    ['otro estado', error(400, cuerpoDeProbable())],
    ['un cuerpo que no es un objeto', error(409, 'texto')],
  ])('no confunde %s con un aviso de duplicado', (_nombre, fallo) => {
    expect(leerConflictoDeDuplicado(fallo)).toBeUndefined();
  });

  it('lo que no es un ErrorApi tampoco lo es', () => {
    expect(leerConflictoDeDuplicado(new Error('x'))).toBeUndefined();
  });
});
