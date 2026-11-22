/**
 * #18 (ADR-009): cabeceras de seguridad, protección CSRF por verificación de origen y límite de intentos de
 * ingreso por usuario y por IP, contra la API completa y PostgreSQL.
 */
import request from 'supertest';
import { LIMITE_POR_IP, LIMITE_POR_USUARIO } from '../src/auth/limite-ingreso.js';
import { CLAVE_DE_PRUEBA, crearApp, crearUsuario, ingresar, limpiarTablas, type AppDePrueba } from './ayudas.js';

const CLAVE_ERRONEA = 'zorro-violeta-4821';

/** Variables de entorno que estas pruebas cambian, para dejarlas como estaban. */
const VARIABLES = ['CONFIAR_EN_PROXY', 'ORIGENES_PERMITIDOS'] as const;
const entornoOriginal = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v]]));

function fijarEntorno(valores: Partial<Record<(typeof VARIABLES)[number], string>>): void {
  for (const v of VARIABLES) {
    if (valores[v] === undefined) delete process.env[v];
    else process.env[v] = valores[v];
  }
}
function restaurarEntorno(): void {
  for (const v of VARIABLES) {
    const antes = entornoOriginal[v];
    if (antes === undefined) delete process.env[v];
    else process.env[v] = antes;
  }
}

async function prepararUsuarios(ctx: AppDePrueba): Promise<void> {
  await limpiarTablas(ctx.pool);
  await crearUsuario(ctx.db, { usuario: 'admin', rol: 'administrador' });
  await crearUsuario(ctx.db, { usuario: 'editor', rol: 'editor' });
}

async function contar(ctx: AppDePrueba, consulta: string, parametros: unknown[] = []): Promise<number> {
  const { rows } = await ctx.pool.query<{ n: number }>(`select count(*)::int as n from ${consulta}`, parametros);
  return rows[0].n;
}

describe('cabeceras de seguridad (helmet)', () => {
  let ctx: AppDePrueba;
  beforeAll(async () => {
    fijarEntorno({});
    ctx = await crearApp();
  });
  afterAll(async () => {
    await ctx.app.close();
    restaurarEntorno();
  });

  it('las respuestas traen las cabeceras de helmet y no delatan el servidor', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('también las respuestas de error', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/documentos');
    expect(res.status).toBe(401);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('CSRF: verificación de origen', () => {
  let ctx: AppDePrueba;
  beforeAll(async () => {
    fijarEntorno({});
    ctx = await crearApp();
  });
  afterAll(async () => {
    await ctx.app.close();
    restaurarEntorno();
  });
  beforeEach(async () => {
    await prepararUsuarios(ctx);
  });

  const credenciales = { usuario: 'admin', clave: CLAVE_DE_PRUEBA };
  const http = () => request(ctx.app.getHttpServer());

  it('un ingreso desde otro sitio se rechaza sin cookie, sin sesión y sin rastro en la auditoría', async () => {
    const res = await http().post('/auth/login').set('Origin', 'https://malo.example').send(credenciales);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ codigo: 'origen_no_permitido' });
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(await contar(ctx, 'sesiones')).toBe(0);
    expect(await contar(ctx, 'auditoria')).toBe(0);
  });

  it('con el mismo origen que el Host, pasa', async () => {
    const res = await http()
      .post('/auth/login')
      .set('Host', 'faro.local')
      .set('Origin', 'http://faro.local')
      .send(credenciales);
    expect(res.status).toBe(200);
  });

  it('Origin: null (iframe con sandbox) se rechaza', async () => {
    const res = await http().post('/auth/login').set('Origin', 'null').send(credenciales);
    expect(res.status).toBe(403);
  });

  it('sin Origin pero con Sec-Fetch-Site entre sitios, se rechaza; same-origin pasa', async () => {
    const malo = await http().post('/auth/login').set('Sec-Fetch-Site', 'cross-site').send(credenciales);
    expect(malo.status).toBe(403);
    const bueno = await http().post('/auth/login').set('Sec-Fetch-Site', 'same-origin').send(credenciales);
    expect(bueno.status).toBe(200);
  });

  it('con sesión válida, una petición que modifica desde otro sitio se rechaza ANTES de hacer nada', async () => {
    const cookie = await ingresar(ctx.app, 'admin');
    const crear = await http()
      .post('/usuarios')
      .set('Cookie', cookie)
      .set('Origin', 'https://malo.example')
      .send({ usuario: 'intruso', nombre: 'Intruso', rol: 'administrador', clave: 'una-clave-larga-123' });
    expect(crear.status).toBe(403);
    expect(crear.body).toMatchObject({ codigo: 'origen_no_permitido' });
    expect(await contar(ctx, 'usuarios where usuario = $1', ['intruso'])).toBe(0);

    const desactivar = await http()
      .patch('/usuarios/2')
      .set('Cookie', cookie)
      .set('Origin', 'https://malo.example')
      .send({ activo: false });
    expect(desactivar.status).toBe(403);
    expect(await contar(ctx, 'usuarios where activo')).toBe(2);
  });

  it('un cierre de sesión desde otro sitio no cierra la sesión', async () => {
    const cookie = await ingresar(ctx.app, 'admin');
    const salir = await http().post('/auth/logout').set('Cookie', cookie).set('Origin', 'https://malo.example');
    expect(salir.status).toBe(403);
    const yo = await http().get('/auth/yo').set('Cookie', cookie);
    expect(yo.body.usuario).toMatchObject({ usuario: 'admin' });
  });

  it('las lecturas no se miran: un GET con Origin ajeno funciona (la política del navegador ya impide leerlo)', async () => {
    const cookie = await ingresar(ctx.app, 'admin');
    const res = await http().get('/auth/yo').set('Cookie', cookie).set('Origin', 'https://malo.example');
    expect(res.status).toBe(200);
  });

  it('sin Origin ni Sec-Fetch-Site (curl, otro servidor, estas pruebas) pasa', async () => {
    const res = await http().post('/auth/login').send(credenciales);
    expect(res.status).toBe(200);
  });
});

describe('CSRF: orígenes permitidos por configuración', () => {
  let ctx: AppDePrueba;
  beforeAll(async () => {
    fijarEntorno({ ORIGENES_PERMITIDOS: 'https://app.ejemplo.com' });
    ctx = await crearApp();
  });
  afterAll(async () => {
    await ctx.app.close();
    restaurarEntorno();
  });
  beforeEach(async () => {
    await prepararUsuarios(ctx);
  });

  it('el origen de la lista pasa y cualquier otro sigue rechazado', async () => {
    const credenciales = { usuario: 'admin', clave: CLAVE_DE_PRUEBA };
    const permitido = await request(ctx.app.getHttpServer())
      .post('/auth/login')
      .set('Origin', 'https://app.ejemplo.com')
      .send(credenciales);
    expect(permitido.status).toBe(200);
    const otro = await request(ctx.app.getHttpServer())
      .post('/auth/login')
      .set('Origin', 'https://otra.ejemplo.com')
      .send(credenciales);
    expect(otro.status).toBe(403);
  });
});

describe('límite de intentos de ingreso', () => {
  let ctx: AppDePrueba;
  beforeAll(async () => {
    // Un proxy delante, como en Cloud Run: la IP sale de X-Forwarded-For.
    fijarEntorno({ CONFIAR_EN_PROXY: '1' });
    ctx = await crearApp();
  });
  afterAll(async () => {
    await ctx.app.close();
    restaurarEntorno();
  });
  beforeEach(async () => {
    await prepararUsuarios(ctx);
  });

  const intentar = (usuario: string, clave: string, ip: string) =>
    request(ctx.app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ usuario, clave });

  /** Inserta intentos ya hechos, para no pagar una verificación de argon2 por cada uno. */
  async function sembrarIntentos(
    cantidad: number,
    datos: (i: number) => { usuario: string; ip: string; haceSegundos?: number },
  ): Promise<void> {
    for (let i = 0; i < cantidad; i++) {
      const { usuario, ip, haceSegundos = 0 } = datos(i);
      await ctx.pool.query(
        "insert into intentos_ingreso (usuario, ip, creado_en) values ($1, $2, now() - make_interval(secs => $3::double precision))",
        [usuario, ip, haceSegundos],
      );
    }
  }

  it(`tras ${LIMITE_POR_USUARIO} claves erróneas, el siguiente intento recibe 429 con Retry-After, aunque la clave sea la correcta`, async () => {
    for (let i = 0; i < LIMITE_POR_USUARIO; i++) {
      expect((await intentar('admin', CLAVE_ERRONEA, '198.51.100.1')).status).toBe(401);
    }
    const bloqueado = await intentar('admin', CLAVE_DE_PRUEBA, '198.51.100.1');
    expect(bloqueado.status).toBe(429);
    expect(bloqueado.body).toMatchObject({ codigo: 'demasiados_intentos' });
    expect(bloqueado.body.message).toMatch(/Intenta de nuevo en \d+ minutos?/);
    const espera = Number(bloqueado.headers['retry-after']);
    expect(espera).toBeGreaterThan(0);
    expect(espera).toBeLessThanOrEqual(15 * 60);
    expect(bloqueado.headers['set-cookie']).toBeUndefined();
    expect(await contar(ctx, 'sesiones')).toBe(0);
  });

  it('bloquear a un usuario no afecta a otro, ni siquiera desde la misma IP', async () => {
    for (let i = 0; i < LIMITE_POR_USUARIO; i++) await intentar('admin', CLAVE_ERRONEA, '198.51.100.2');
    expect((await intentar('admin', CLAVE_DE_PRUEBA, '198.51.100.2')).status).toBe(429);
    expect((await intentar('editor', CLAVE_DE_PRUEBA, '198.51.100.2')).status).toBe(200);
  });

  it('un usuario que no existe se limita igual: la respuesta no delata cuáles existen', async () => {
    for (let i = 0; i < LIMITE_POR_USUARIO; i++) {
      expect((await intentar('fantasma', CLAVE_ERRONEA, '198.51.100.3')).status).toBe(401);
    }
    const inexistente = await intentar('fantasma', CLAVE_ERRONEA, '198.51.100.3');

    for (let i = 0; i < LIMITE_POR_USUARIO; i++) await intentar('admin', CLAVE_ERRONEA, '198.51.100.4');
    const existente = await intentar('admin', CLAVE_ERRONEA, '198.51.100.4');

    expect(inexistente.status).toBe(429);
    expect(existente.status).toBe(429);
    expect(inexistente.body).toEqual(existente.body);
  });

  it('el nombre se cuenta sin distinguir mayúsculas ni espacios de los lados', async () => {
    await intentar('ADMIN', CLAVE_ERRONEA, '198.51.100.5');
    await intentar('Admin', CLAVE_ERRONEA, '198.51.100.5');
    await intentar(' admin ', CLAVE_ERRONEA, '198.51.100.5');
    await intentar('admin', CLAVE_ERRONEA, '198.51.100.5');
    await intentar('aDmIn', CLAVE_ERRONEA, '198.51.100.5');
    expect((await intentar('admin', CLAVE_DE_PRUEBA, '198.51.100.5')).status).toBe(429);
  });

  it('un ingreso correcto reinicia la cuenta del usuario', async () => {
    for (let i = 0; i < LIMITE_POR_USUARIO - 1; i++) await intentar('admin', CLAVE_ERRONEA, '198.51.100.6');
    expect(await contar(ctx, "intentos_ingreso where usuario = 'admin'")).toBe(LIMITE_POR_USUARIO - 1);
    expect((await intentar('admin', CLAVE_DE_PRUEBA, '198.51.100.6')).status).toBe(200);
    expect(await contar(ctx, "intentos_ingreso where usuario = 'admin'")).toBe(0);
    // Y vuelve a tener todos sus intentos.
    for (let i = 0; i < LIMITE_POR_USUARIO; i++) {
      expect((await intentar('admin', CLAVE_ERRONEA, '198.51.100.6')).status).toBe(401);
    }
  });

  it('un ingreso correcto limpia además lo que ya tiene más de un día', async () => {
    await sembrarIntentos(1, () => ({ usuario: 'otro', ip: '198.51.100.99', haceSegundos: 2 * 24 * 3600 }));
    await sembrarIntentos(1, () => ({ usuario: 'reciente', ip: '198.51.100.98' }));
    expect((await intentar('editor', CLAVE_DE_PRUEBA, '198.51.100.7')).status).toBe(200);
    expect(await contar(ctx, "intentos_ingreso where usuario = 'otro'")).toBe(0);
    expect(await contar(ctx, "intentos_ingreso where usuario = 'reciente'")).toBe(1);
  });

  it('insistir estando bloqueado no registra más intentos ni alarga el bloqueo', async () => {
    for (let i = 0; i < LIMITE_POR_USUARIO; i++) await intentar('admin', CLAVE_ERRONEA, '198.51.100.8');
    for (let i = 0; i < 8; i++) expect((await intentar('admin', CLAVE_ERRONEA, '198.51.100.8')).status).toBe(429);
    expect(await contar(ctx, "intentos_ingreso where usuario = 'admin'")).toBe(LIMITE_POR_USUARIO);
  });

  describe('ventana de 15 minutos', () => {
    it('los intentos de hace más de 15 minutos ya no cuentan', async () => {
      await sembrarIntentos(LIMITE_POR_USUARIO, () => ({ usuario: 'admin', ip: '198.51.100.9', haceSegundos: 16 * 60 }));
      expect((await intentar('admin', CLAVE_DE_PRUEBA, '198.51.100.9')).status).toBe(200);
    });

    it('con 5 intentos de hace 14 minutos sigue bloqueado y Retry-After dice cuánto falta (~1 minuto)', async () => {
      await sembrarIntentos(LIMITE_POR_USUARIO, () => ({ usuario: 'admin', ip: '198.51.100.10', haceSegundos: 14 * 60 }));
      const res = await intentar('admin', CLAVE_DE_PRUEBA, '198.51.100.10');
      expect(res.status).toBe(429);
      const espera = Number(res.headers['retry-after']);
      expect(espera).toBeGreaterThanOrEqual(55);
      expect(espera).toBeLessThanOrEqual(62);
    });
  });

  describe('por IP', () => {
    it(`el intento número ${LIMITE_POR_IP} de una IP todavía se atiende y el siguiente, aunque sea de otro usuario, recibe 429`, async () => {
      await sembrarIntentos(LIMITE_POR_IP - 1, (i) => ({ usuario: `u${i}`, ip: '203.0.113.50' }));
      expect((await intentar('nadie-1', CLAVE_ERRONEA, '203.0.113.50')).status).toBe(401);
      const bloqueado = await intentar('nadie-2', CLAVE_ERRONEA, '203.0.113.50');
      expect(bloqueado.status).toBe(429);
      expect(Number(bloqueado.headers['retry-after'])).toBeGreaterThan(0);
    });

    it('otra IP no se ve afectada', async () => {
      await sembrarIntentos(LIMITE_POR_IP, (i) => ({ usuario: `u${i}`, ip: '203.0.113.51' }));
      expect((await intentar('editor', CLAVE_DE_PRUEBA, '203.0.113.52')).status).toBe(200);
    });

    it('un ingreso correcto no se cuenta contra la IP: una oficina entera puede entrar por la misma IP', async () => {
      for (let i = 0; i < 3; i++) expect((await intentar('admin', CLAVE_DE_PRUEBA, '203.0.113.53')).status).toBe(200);
      expect(await contar(ctx, "intentos_ingreso where ip = '203.0.113.53'")).toBe(0);
    });

    it('con un proxy de confianza cuenta la última dirección de X-Forwarded-For, no la que escribe el cliente', async () => {
      await sembrarIntentos(LIMITE_POR_IP, (i) => ({ usuario: `u${i}`, ip: '198.51.100.200' }));
      // Quien agrega el proxy es lo último: la IP real. Lo que va a la izquierda lo puede escribir cualquiera.
      const real = await intentar('nadie', CLAVE_ERRONEA, '203.0.113.77, 198.51.100.200');
      expect(real.status).toBe(429);
      const disfrazada = await intentar('nadie', CLAVE_ERRONEA, '198.51.100.200, 203.0.113.77');
      expect(disfrazada.status).toBe(401);
    });
  });

  describe('auditoría', () => {
    it('queda un solo evento ingreso_bloqueado, en el intento que agota el límite, y no se llena al insistir', async () => {
      for (let i = 0; i < LIMITE_POR_USUARIO; i++) await intentar('admin', CLAVE_ERRONEA, '198.51.100.11');
      for (let i = 0; i < 6; i++) await intentar('admin', CLAVE_ERRONEA, '198.51.100.11');
      expect(await contar(ctx, "auditoria where accion = 'ingreso_fallido'")).toBe(LIMITE_POR_USUARIO);
      expect(await contar(ctx, "auditoria where accion = 'ingreso_bloqueado'")).toBe(1);
      const { rows } = await ctx.pool.query<{ detalle: string; usuario_id: number | null }>(
        "select detalle, usuario_id from auditoria where accion = 'ingreso_bloqueado'",
      );
      expect(rows[0].detalle).toBe('límite de intentos alcanzado por usuario');
      expect(rows[0].usuario_id).not.toBeNull();
    });

    it('un intento rechazado por el límite no se audita como ingreso fallido ni revela el nombre escrito', async () => {
      for (let i = 0; i < LIMITE_POR_USUARIO; i++) await intentar('fantasma', CLAVE_ERRONEA, '198.51.100.12');
      const antes = await contar(ctx, 'auditoria');
      await intentar('fantasma', CLAVE_ERRONEA, '198.51.100.12');
      expect(await contar(ctx, 'auditoria')).toBe(antes);
      const { rows } = await ctx.pool.query<{ detalle: string | null }>('select detalle from auditoria');
      expect(JSON.stringify(rows)).not.toContain('fantasma');
    });
  });

  it(`con 20 intentos a la vez, a lo sumo ${LIMITE_POR_USUARIO} llegan a verificarse y ninguno termina en error 5xx`, async () => {
    const respuestas = await Promise.all(
      Array.from({ length: 20 }, () => intentar('admin', CLAVE_ERRONEA, '198.51.100.13')),
    );
    const estados = respuestas.map((r) => r.status);
    expect(estados.every((e) => e === 401 || e === 429)).toBe(true);
    expect(estados.filter((e) => e === 401).length).toBeLessThanOrEqual(LIMITE_POR_USUARIO);
    expect(estados.filter((e) => e === 429).length).toBeGreaterThanOrEqual(20 - LIMITE_POR_USUARIO);
    // Pasada la ráfaga, el usuario sigue bloqueado.
    expect((await intentar('admin', CLAVE_DE_PRUEBA, '198.51.100.13')).status).toBe(429);
  }, 30_000);
});

describe('límite por IP sin proxy de confianza', () => {
  let ctx: AppDePrueba;
  beforeAll(async () => {
    fijarEntorno({ CONFIAR_EN_PROXY: '0' });
    ctx = await crearApp();
  });
  afterAll(async () => {
    await ctx.app.close();
    restaurarEntorno();
  });
  beforeEach(async () => {
    await prepararUsuarios(ctx);
  });

  it('X-Forwarded-For se ignora: no sirve para cambiar de IP y esquivar el límite', async () => {
    const http = () => request(ctx.app.getHttpServer());
    // Un primer intento fallido revela qué IP ve la API (la de la conexión).
    await http().post('/auth/login').set('X-Forwarded-For', '203.0.113.1').send({ usuario: 'a', clave: CLAVE_ERRONEA });
    const { rows } = await ctx.pool.query<{ ip: string }>('select ip from intentos_ingreso');
    const ipDeLaConexion = rows[0].ip;
    expect(ipDeLaConexion).not.toBe('203.0.113.1');

    for (let i = 1; i < LIMITE_POR_IP; i++) {
      await ctx.pool.query('insert into intentos_ingreso (usuario, ip) values ($1, $2)', [`u${i}`, ipDeLaConexion]);
    }
    const res = await http()
      .post('/auth/login')
      .set('X-Forwarded-For', '203.0.113.99')
      .send({ usuario: 'editor', clave: CLAVE_DE_PRUEBA });
    expect(res.status).toBe(429);
  });
});
