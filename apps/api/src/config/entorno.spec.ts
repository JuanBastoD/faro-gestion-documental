import { EntornoInvalidoError, validarEntorno } from './entorno.js';

const URL_VALIDA = 'postgresql://faro:clave-secreta-123@localhost:5433/faro';

describe('validarEntorno', () => {
  it('acepta un entorno mínimo y aplica los valores por defecto', () => {
    const entorno = validarEntorno({ DATABASE_URL: URL_VALIDA });
    expect(entorno).toEqual({
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: 3000,
      DATABASE_URL: URL_VALIDA,
      ALMACEN_TIPO: 'disco',
      ALMACEN_RUTA: 'almacen-local',
      UMBRAL_SIMILITUD: 0.8,
      CONFIAR_EN_PROXY: 0,
      ORIGENES_PERMITIDOS: [],
      S3_REGION: 'us-east-1',
    });
  });

  describe('proxies de confianza (ADR-009)', () => {
    it('acepta un entero de 0 a 5, también como texto', () => {
      expect(validarEntorno({ DATABASE_URL: URL_VALIDA, CONFIAR_EN_PROXY: '1' }).CONFIAR_EN_PROXY).toBe(1);
      expect(validarEntorno({ DATABASE_URL: URL_VALIDA, CONFIAR_EN_PROXY: '5' }).CONFIAR_EN_PROXY).toBe(5);
    });

    it.each(['-1', '6', '1.5', 'dos'])('rechaza %s y nombra la variable', (valor) => {
      expect(() => validarEntorno({ DATABASE_URL: URL_VALIDA, CONFIAR_EN_PROXY: valor })).toThrow(/CONFIAR_EN_PROXY/);
    });
  });

  describe('orígenes permitidos (ADR-009)', () => {
    it('separa por comas, recorta espacios e ignora los vacíos', () => {
      const entorno = validarEntorno({
        DATABASE_URL: URL_VALIDA,
        ORIGENES_PERMITIDOS: ' https://app.ejemplo.com , http://localhost:5173,, ',
      });
      expect(entorno.ORIGENES_PERMITIDOS).toEqual(['https://app.ejemplo.com', 'http://localhost:5173']);
    });

    it.each(['app.ejemplo.com', 'https://app.ejemplo.com/', 'https://app.ejemplo.com/ruta', 'null', 'https://a.com,b'])(
      'rechaza %s: un origen es https://dominio[:puerto] sin ruta ni barra final',
      (valor) => {
        expect(() => validarEntorno({ DATABASE_URL: URL_VALIDA, ORIGENES_PERMITIDOS: valor })).toThrow(
          /ORIGENES_PERMITIDOS/,
        );
      },
    );
  });

  describe('umbral de similitud', () => {
    it('acepta un número entre 0,5 y 1, también como texto', () => {
      expect(validarEntorno({ DATABASE_URL: URL_VALIDA, UMBRAL_SIMILITUD: '0.9' }).UMBRAL_SIMILITUD).toBe(0.9);
      expect(validarEntorno({ DATABASE_URL: URL_VALIDA, UMBRAL_SIMILITUD: '1' }).UMBRAL_SIMILITUD).toBe(1);
    });

    it.each(['0.2', '1.5', 'alto', '-1'])('rechaza %s con un mensaje claro', (valor) => {
      expect(() => validarEntorno({ DATABASE_URL: URL_VALIDA, UMBRAL_SIMILITUD: valor })).toThrow(/UMBRAL_SIMILITUD/);
    });
  });

  describe('almacén de archivos', () => {
    const S3 = {
      ALMACEN_TIPO: 's3',
      S3_ENDPOINT: 'http://localhost:9000',
      S3_BUCKET: 'faro-documentos',
      S3_ACCESS_KEY: 'acceso',
      S3_SECRET_KEY: 'secreto-que-no-debe-aparecer',
    };

    it('con s3 y todas las variables, las acepta', () => {
      const entorno = validarEntorno({ DATABASE_URL: URL_VALIDA, ...S3 });
      expect(entorno.ALMACEN_TIPO).toBe('s3');
      expect(entorno.S3_BUCKET).toBe('faro-documentos');
    });

    it('con s3 y una variable ausente, nombra la que falta', () => {
      const { S3_BUCKET: _quitada, ...incompleta } = S3;
      expect(() => validarEntorno({ DATABASE_URL: URL_VALIDA, ...incompleta })).toThrow(/S3_BUCKET/);
    });

    it('con disco no exige las variables de S3', () => {
      expect(() => validarEntorno({ DATABASE_URL: URL_VALIDA, ALMACEN_TIPO: 'disco' })).not.toThrow();
    });

    it('rechaza un tipo desconocido sin mostrar secretos', () => {
      const intento = () => validarEntorno({ DATABASE_URL: URL_VALIDA, ...S3, ALMACEN_TIPO: 'nube' });
      expect(intento).toThrow(/ALMACEN_TIPO/);
      try {
        intento();
      } catch (error) {
        expect((error as Error).message).not.toContain('secreto-que-no-debe-aparecer');
      }
    });

    it('rechaza un endpoint que no es una URL', () => {
      expect(() =>
        validarEntorno({ DATABASE_URL: URL_VALIDA, ...S3, S3_ENDPOINT: 'localhost:9000-no-url' }),
      ).toThrow(/S3_ENDPOINT/);
    });
  });

  it('convierte PORT de texto a número (Cloud Run lo entrega como texto)', () => {
    const entorno = validarEntorno({ DATABASE_URL: URL_VALIDA, PORT: '8080', HOST: '0.0.0.0' });
    expect(entorno.PORT).toBe(8080);
    expect(entorno.HOST).toBe('0.0.0.0');
  });

  it('acepta postgres:// además de postgresql://', () => {
    expect(() => validarEntorno({ DATABASE_URL: 'postgres://u:p@host/db' })).not.toThrow();
  });

  it('falla y nombra DATABASE_URL cuando falta', () => {
    expect(() => validarEntorno({})).toThrow(EntornoInvalidoError);
    expect(() => validarEntorno({})).toThrow(/DATABASE_URL: es obligatoria/);
  });

  it('falla si DATABASE_URL no es de PostgreSQL', () => {
    expect(() => validarEntorno({ DATABASE_URL: 'mysql://u:p@host/db' })).toThrow(
      /DATABASE_URL: debe empezar por postgresql:\/\/ o postgres:\/\//,
    );
  });

  it.each(['abc', '0', '70000', '30.5', ''])('rechaza PORT inválido (%j)', (puerto) => {
    expect(() => validarEntorno({ DATABASE_URL: URL_VALIDA, PORT: puerto })).toThrow(/PORT:/);
  });

  it('rechaza NODE_ENV desconocido', () => {
    expect(() => validarEntorno({ DATABASE_URL: URL_VALIDA, NODE_ENV: 'staging' })).toThrow(
      /NODE_ENV: debe ser development, test o production/,
    );
  });

  it('informa todos los problemas a la vez, no solo el primero', () => {
    let mensaje = '';
    try {
      validarEntorno({ PORT: 'x' });
    } catch (error) {
      mensaje = (error as Error).message;
    }
    expect(mensaje).toMatch(/PORT:/);
    expect(mensaje).toMatch(/DATABASE_URL:/);
  });

  it('nunca incluye el valor de DATABASE_URL (lleva la clave) en el mensaje de error', () => {
    let mensaje = '';
    try {
      validarEntorno({ DATABASE_URL: 'mysql://faro:clave-secreta-123@host/db' });
    } catch (error) {
      mensaje = (error as Error).message;
    }
    expect(mensaje).not.toContain('clave-secreta-123');
    expect(mensaje).not.toContain('mysql://');
  });
});
