import {
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ACCION } from '../auditoria/acciones.js';
import type { AuditoriaService } from '../auditoria/auditoria.service.js';
import type { AlmacenArchivos } from '../almacen/almacen-archivos.js';
import type { UsuarioSesion } from '../auth/roles.js';
import type { TextoDeVersion } from '../similitud/texto-pdf.js';
import { DatosInvalidosError } from './datos-carga.js';
import type { DocumentosRepository, Transaccion, VersionDetalle } from './documentos.repository.js';
import { VersionesService } from './versiones.service.js';

const USUARIO: UsuarioSesion = { id: 5, usuario: 'editor.demo', nombre: 'Editor Demo', rol: 'editor' };
const TX = { esTransaccion: true } as unknown as Transaccion;
const PDF = Buffer.from('%PDF-1.4\nContenido ficticio de una prueba\n%%EOF');
const ARCHIVO = { nombre: 'informe.pdf', datos: PDF };
const TEXTO: TextoDeVersion = { estado: 'ok', textoNormalizado: 'texto ficticio', firma: Buffer.from([1, 2, 3, 4]), palabras: 60 };
const DETALLE = { numero: 3 } as unknown as VersionDetalle;

/** Servicio con un repositorio, un almacén y una auditoría falsos que anotan el orden de las llamadas. */
function crear(
  ajustes: {
    existe?: boolean;
    bloqueado?: boolean;
    repetida?: number;
    vigente?: { numero: number; sha256: string } | undefined;
    origen?: { archivo: string; nombreOriginal: string; sha256: string; tamano: number } | undefined;
    textoOrigen?: { textoEstado: 'ok' | 'sin_texto'; textoNormalizado: string | null; firma: Buffer | null };
    objetoEnAlmacen?: boolean;
    objetoReferenciado?: boolean;
    falloAlInsertar?: unknown;
    falloAlBorrar?: unknown;
  } = {},
) {
  const orden: string[] = [];
  const nota = (nombre: string) => orden.push(nombre);
  const repositorio = {
    existeDocumento: vi.fn(() => Promise.resolve(ajustes.existe ?? true)),
    listarVersiones: vi.fn(() => Promise.resolve([DETALLE])),
    enTransaccion: vi.fn(async (trabajo: (tx: Transaccion) => Promise<unknown>) => {
      nota('transaccion:abre');
      try {
        return await trabajo(TX);
      } finally {
        nota('transaccion:cierra');
      }
    }),
    bloquearDocumento: vi.fn(() => Promise.resolve(ajustes.bloqueado ?? true)),
    numeroConHuella: vi.fn(() => Promise.resolve(ajustes.repetida)),
    versionVigente: vi.fn(() => Promise.resolve('vigente' in ajustes ? ajustes.vigente : { numero: 2, sha256: 'v'.repeat(64) })),
    insertarVersion: vi.fn(() => {
      nota('insertarVersion');
      return ajustes.falloAlInsertar ? Promise.reject(ajustes.falloAlInsertar as Error) : Promise.resolve();
    }),
    actualizarBusqueda: vi.fn(() => {
      nota('actualizarBusqueda');
      return Promise.resolve();
    }),
    detalleDeVersion: vi.fn(() => Promise.resolve(DETALLE)),
    buscarVersionCompleta: vi.fn(() => Promise.resolve('origen' in ajustes ? ajustes.origen : { archivo: 'documentos/o.pdf', nombreOriginal: 'o.pdf', sha256: 'o'.repeat(64), tamano: 99 })),
    buscarTexto: vi.fn(() => Promise.resolve(ajustes.textoOrigen)),
    objetoReferenciado: vi.fn(() => Promise.resolve(ajustes.objetoReferenciado ?? false)),
  };
  const almacen = {
    guardar: vi.fn(() => {
      nota('almacen:guardar');
      return Promise.resolve();
    }),
    existe: vi.fn(() => Promise.resolve(ajustes.objetoEnAlmacen ?? true)),
    borrar: vi.fn(() => {
      nota('almacen:borrar');
      return ajustes.falloAlBorrar ? Promise.reject(ajustes.falloAlBorrar as Error) : Promise.resolve();
    }),
  };
  const auditoria = {
    registrar: vi.fn(() => {
      nota('auditoria');
      return Promise.resolve();
    }),
  };
  const servicio = new VersionesService(
    repositorio as unknown as DocumentosRepository,
    almacen as unknown as AlmacenArchivos,
    auditoria as unknown as AuditoriaService,
  );
  return { servicio, repositorio, almacen, auditoria, orden };
}

let registroError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  registroError = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('VersionesService.listar', () => {
  it('devuelve el historial del documento', async () => {
    const { servicio, repositorio } = crear();
    expect(await servicio.listar(4)).toEqual([DETALLE]);
    expect(repositorio.listarVersiones).toHaveBeenCalledWith(4);
  });

  it('un documento que no existe da 404 y no consulta versiones', async () => {
    const { servicio, repositorio } = crear({ existe: false });
    await expect(servicio.listar(4)).rejects.toBeInstanceOf(NotFoundException);
    expect(repositorio.listarVersiones).not.toHaveBeenCalled();
  });
});

describe('VersionesService.agregar', () => {
  const agregar = (s: VersionesService, cuerpo: unknown = { motivo: 'Corrige el valor' }, archivo: typeof ARCHIVO | undefined = ARCHIVO) =>
    s.agregar(9, cuerpo, archivo, USUARIO, { texto: TEXTO });

  describe('lo que rechaza antes de tocar el almacén', () => {
    it.each([
      ['sin motivo', {}],
      ['con un motivo de solo espacios', { motivo: '   ' }],
      ['con un motivo de más de 300 caracteres', { motivo: 'x'.repeat(301) }],
    ])('%s: datos inválidos', async (_nombre, cuerpo) => {
      const { servicio, almacen } = crear();
      await expect(agregar(servicio, cuerpo)).rejects.toBeInstanceOf(DatosInvalidosError);
      expect(almacen.guardar).not.toHaveBeenCalled();
    });

    it('sin archivo: 400', async () => {
      const { servicio, almacen } = crear();
      // Directo, sin el ayudante: un `undefined` allí tomaría el archivo por defecto.
      await expect(servicio.agregar(9, { motivo: 'm' }, undefined, USUARIO)).rejects.toBeInstanceOf(BadRequestException);
      expect(almacen.guardar).not.toHaveBeenCalled();
    });

    it('un archivo que no es PDF: 415', async () => {
      const { servicio, almacen } = crear();
      await expect(
        agregar(servicio, { motivo: 'm' }, { nombre: 'x.pdf', datos: Buffer.from('<html>no</html>') }),
      ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
      expect(almacen.guardar).not.toHaveBeenCalled();
    });

    it('un documento que no existe: 404, y el archivo no se sube', async () => {
      const { servicio, almacen } = crear({ existe: false });
      await expect(agregar(servicio)).rejects.toBeInstanceOf(NotFoundException);
      expect(almacen.guardar).not.toHaveBeenCalled();
    });
  });

  describe('el camino bueno', () => {
    it('guarda el objeto primero y luego, en una sola transacción, la fila, la auditoría y el índice', async () => {
      const { servicio, orden } = crear();
      await agregar(servicio);
      expect(orden).toEqual([
        'almacen:guardar',
        'transaccion:abre',
        'insertarVersion',
        'auditoria',
        'actualizarBusqueda',
        'transaccion:cierra',
      ]);
    });

    it('la versión nueva es la siguiente a la vigente y lleva motivo, autor, huella y texto', async () => {
      const { servicio, repositorio } = crear({ vigente: { numero: 4, sha256: 'v'.repeat(64) } });
      await agregar(servicio, { motivo: '  Corrige el valor  ' });
      expect(repositorio.insertarVersion).toHaveBeenCalledWith(
        TX,
        expect.objectContaining({
          documentoId: 9,
          numero: 5,
          motivo: 'Corrige el valor',
          autorId: USUARIO.id,
          nombreOriginal: 'informe.pdf',
          tamano: PDF.length,
          textoEstado: 'ok',
          textoNormalizado: 'texto ficticio',
          firma: TEXTO.firma,
        }),
      );
      const [{ archivo, sha256 }] = repositorio.insertarVersion.mock.calls[0].slice(1) as [{ archivo: string; sha256: string }];
      expect(archivo).toBe(`documentos/${sha256}.pdf`);
    });

    it('un documento sin versiones empieza en la 1', async () => {
      const { servicio, repositorio } = crear({ vigente: undefined });
      await agregar(servicio);
      expect(repositorio.insertarVersion).toHaveBeenCalledWith(TX, expect.objectContaining({ numero: 1 }));
    });

    it('audita la versión con la acción, el documento y la huella corta, dentro de la misma transacción', async () => {
      const { servicio, auditoria } = crear();
      await agregar(servicio);
      expect(auditoria.registrar).toHaveBeenCalledWith(
        { usuarioId: USUARIO.id, accion: ACCION.VERSION, documentoId: 9, detalle: expect.stringMatching(/^versión 3; sha256 [0-9a-f]{12}$/) },
        TX,
      );
    });

    it('bloquea el documento antes de leer su versión vigente', async () => {
      const { servicio, repositorio } = crear();
      await agregar(servicio);
      const bloqueo = repositorio.bloquearDocumento.mock.invocationCallOrder[0];
      const lectura = repositorio.versionVigente.mock.invocationCallOrder[0];
      expect(bloqueo).toBeLessThan(lectura);
    });

    it('ejecuta `alRegistrar` dentro de la transacción con el número nuevo', async () => {
      const { servicio, orden } = crear();
      const alRegistrar = vi.fn((_tx: Transaccion, _numero: number) => {
        orden.push('alRegistrar');
        return Promise.resolve();
      });
      await servicio.agregar(9, { motivo: 'm' }, ARCHIVO, USUARIO, { texto: TEXTO, alRegistrar });
      expect(alRegistrar).toHaveBeenCalledWith(TX, 3);
      expect(orden.indexOf('alRegistrar')).toBeLessThan(orden.indexOf('transaccion:cierra'));
    });

    it('devuelve el detalle de la versión creada', async () => {
      const { servicio, repositorio } = crear();
      expect(await agregar(servicio)).toBe(DETALLE);
      expect(repositorio.detalleDeVersion).toHaveBeenCalledWith(9, 3);
    });
  });

  describe('cuando algo falla después de guardar el objeto', () => {
    it('el mismo contenido ya está en una versión: 409 que dice cuál y el objeto se limpia', async () => {
      const { servicio, almacen, repositorio } = crear({ repetida: 2 });
      const error = await agregar(servicio).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({ statusCode: 409, versionExistente: 2 });
      expect(repositorio.insertarVersion).not.toHaveBeenCalled();
      expect(almacen.borrar).toHaveBeenCalledOnce();
    });

    it('no borra el objeto si otra versión lo usa (el mismo archivo en otro documento)', async () => {
      const { servicio, almacen } = crear({ repetida: 2, objetoReferenciado: true });
      await expect(agregar(servicio)).rejects.toBeInstanceOf(ConflictException);
      expect(almacen.borrar).not.toHaveBeenCalled();
    });

    it('si dos cargas idénticas llegan a la vez, la restricción única se traduce a 409', async () => {
      const { servicio, almacen } = crear({ falloAlInsertar: { cause: { code: '23505' } } });
      const error = await agregar(servicio).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({ versionExistente: null });
      expect(almacen.borrar).toHaveBeenCalledOnce();
    });

    it('un error cualquiera se propaga tal cual, después de limpiar el objeto', async () => {
      const fallo = new Error('se cayó la base');
      const { servicio, almacen } = crear({ falloAlInsertar: fallo });
      await expect(agregar(servicio)).rejects.toBe(fallo);
      expect(almacen.borrar).toHaveBeenCalledOnce();
    });

    it('si la limpieza también falla, no tapa el error original y queda registrado', async () => {
      const fallo = new Error('se cayó la base');
      const { servicio } = crear({ falloAlInsertar: fallo, falloAlBorrar: new Error('almacén caído') });
      await expect(agregar(servicio)).rejects.toBe(fallo);
      expect(registroError).toHaveBeenCalledWith(expect.stringContaining('huérfano'));
    });

    it('un documento que desaparece entre la comprobación y el bloqueo da 404 y limpia el objeto', async () => {
      const { servicio, almacen } = crear({ bloqueado: false });
      await expect(agregar(servicio)).rejects.toBeInstanceOf(NotFoundException);
      expect(almacen.borrar).toHaveBeenCalledOnce();
    });
  });
});

describe('VersionesService.restaurar', () => {
  const restaurar = (s: VersionesService, numero = 1, cuerpo: unknown = {}) => s.restaurar(9, numero, cuerpo, USUARIO);

  it('un documento que no existe: 404', async () => {
    const { servicio, repositorio } = crear({ bloqueado: false });
    await expect(restaurar(servicio)).rejects.toBeInstanceOf(NotFoundException);
    expect(repositorio.insertarVersion).not.toHaveBeenCalled();
  });

  it('una versión que no existe: 404 que dice cuál', async () => {
    const { servicio } = crear({ origen: undefined });
    await expect(restaurar(servicio, 8)).rejects.toThrow(/versión 8 del documento 9/);
  });

  it('restaurar la que ya es la vigente: 409', async () => {
    const sha = 'o'.repeat(64);
    const { servicio, repositorio } = crear({ vigente: { numero: 1, sha256: sha } });
    const error = await restaurar(servicio, 1).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({ versionVigente: 1, message: 'La versión 1 ya es la vigente' });
    expect(repositorio.insertarVersion).not.toHaveBeenCalled();
  });

  it('restaurar una versión cuyo contenido ya es el de la vigente: 409 que lo explica', async () => {
    const sha = 'o'.repeat(64);
    const { servicio } = crear({ vigente: { numero: 3, sha256: sha } });
    const error = await restaurar(servicio, 1).catch((e: unknown) => e);
    expect((error as ConflictException).getResponse()).toMatchObject({
      versionVigente: 3,
      message: 'La versión vigente (3) ya tiene el mismo contenido que la 1',
    });
  });

  it('si el archivo de esa versión ya no está en el almacén: 404 y no se crea nada', async () => {
    const { servicio, repositorio } = crear({ objetoEnAlmacen: false });
    await expect(restaurar(servicio)).rejects.toThrow('El archivo de esa versión no está disponible');
    expect(repositorio.insertarVersion).not.toHaveBeenCalled();
    expect(registroError).toHaveBeenCalled();
  });

  it('crea una versión nueva que apunta al mismo objeto y copia su texto y firma', async () => {
    const textoOrigen = { textoEstado: 'ok' as const, textoNormalizado: 'texto de la versión uno', firma: Buffer.from([9, 9]) };
    const { servicio, repositorio, almacen } = crear({ textoOrigen });
    await restaurar(servicio, 1);
    expect(repositorio.insertarVersion).toHaveBeenCalledWith(TX, {
      documentoId: 9,
      numero: 3,
      archivo: 'documentos/o.pdf',
      nombreOriginal: 'o.pdf',
      sha256: 'o'.repeat(64),
      tamano: 99,
      motivo: 'Restaura la versión 1',
      restauradaDe: 1,
      autorId: USUARIO.id,
      textoEstado: 'ok',
      textoNormalizado: 'texto de la versión uno',
      firma: textoOrigen.firma,
    });
    // No copia el archivo: el objeto es el mismo.
    expect(almacen.guardar).not.toHaveBeenCalled();
  });

  it('si la versión restaurada no tenía texto, la nueva tampoco', async () => {
    const { servicio, repositorio } = crear({ textoOrigen: undefined });
    await restaurar(servicio, 1);
    expect(repositorio.insertarVersion).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ textoEstado: 'sin_texto', textoNormalizado: null, firma: null }),
    );
  });

  it('usa el motivo que se da, sin espacios sobrantes', async () => {
    const { servicio, repositorio } = crear();
    await restaurar(servicio, 1, { motivo: '  Se subió la equivocada  ' });
    expect(repositorio.insertarVersion).toHaveBeenCalledWith(TX, expect.objectContaining({ motivo: 'Se subió la equivocada' }));
  });

  it('un motivo de más de 300 caracteres: datos inválidos', async () => {
    const { servicio } = crear();
    await expect(restaurar(servicio, 1, { motivo: 'x'.repeat(301) })).rejects.toBeInstanceOf(DatosInvalidosError);
  });

  it('audita la restauración y actualiza el índice de búsqueda en la misma transacción', async () => {
    const { servicio, auditoria, orden } = crear();
    await restaurar(servicio, 1);
    expect(auditoria.registrar).toHaveBeenCalledWith(
      { usuarioId: USUARIO.id, accion: ACCION.RESTAURACION, documentoId: 9, detalle: 'versión 1 restaurada como versión 3' },
      TX,
    );
    expect(orden).toEqual(['transaccion:abre', 'insertarVersion', 'auditoria', 'actualizarBusqueda', 'transaccion:cierra']);
  });
});
