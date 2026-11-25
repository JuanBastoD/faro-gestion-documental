import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { expect, test } from '@playwright/test';
import {
  idDelDocumentoAbierto,
  ingresar,
  irACargar,
  listaDeCandidatos,
  llenarFormularioDeCarga,
  menuPrincipal,
  pantallaDeDuplicado,
  tarjetaDeVersion,
} from './ayudas/acciones.ts';
import { afirmarListaDeCandidatos, cambiarAncho } from './ayudas/diseno.ts';
import { generarPdfs, semillaDeLaCorrida, type PdfsDeLaPrueba } from './ayudas/pdfs.ts';
import { abrirSesion, cerrarSesiones, guardarEvidenciaDelFallo, type Sesion } from './ayudas/sesion.ts';

/**
 * Flujo de demostración de punta a punta (issue #26): ingreso, carga, duplicado probable, nueva versión y auditoría, en
 * Chromium real contra la API compilada que sirve `/app/` y PostgreSQL real, con los usuarios `*.demo` de la siembra y PDF
 * ficticios generados en memoria. Los pasos son una serie con estado (cada uno usa lo que dejó el anterior): si uno falla,
 * los siguientes no se ejecutan, y el número del paso dice dónde se rompió el recorrido.
 *
 * Además del recorrido, tres comprobaciones que ya costaron un defecto o que solo un navegador real puede hacer:
 *   (1) las opciones de «Elige con cuál quieres comparar» no se montan unas sobre otras ni cortan su texto (1280 y 360 px);
 *   (2) ninguna página tuvo errores de consola ni respuestas de error que la prueba no provocara;
 *   (3) la guarda de origen deja pasar lo que envía la propia interfaz y rechaza lo que viene de otro origen.
 */

const USUARIO_EDITOR = 'editor.demo';
const USUARIO_ADMINISTRADOR = 'admin.demo';
const CLAVE_INCORRECTA = 'esta-clave-no-es-la-de-nadie';

const TITULO_ORIGINAL = 'Contrato de obra de la vía Tibú-Convención';
const TITULO_REESCANEO = 'Reescaneo del contrato de la vía Tibú-Convención';
// Títulos largos a propósito: son los que más estiran las filas de la lista de candidatos.
const TITULO_B =
  'Contrato de obra para el mejoramiento y la pavimentación de la vía Tibú-Convención, tramo rural del corredor del Catatumbo, segundo lote';
const TITULO_C =
  'Contrato de interventoría técnica, administrativa, financiera y ambiental de la vía Tibú-Convención, tramo rural del corredor del Catatumbo, tercer lote';
const TITULO_D = 'Contrato de obra reescaneado, cuarto envío del mismo archivo';

/** La clave con que la siembra creó a los usuarios de demostración. No hay ninguna escrita en el código. */
function claveDeLaSiembra(): string {
  const clave = process.env.SEMILLA_CLAVE;
  if (!clave) {
    throw new Error(
      'Falta la variable SEMILLA_CLAVE: es la clave con que se sembraron admin.demo y editor.demo (npm run db:seed -w apps/api). Ver README, «Pruebas de navegador».',
    );
  }
  return clave;
}

const sha256 = (datos: Buffer) => createHash('sha256').update(datos).digest('hex');

test.describe.serial('Flujo de demostración: ingreso, carga, duplicado probable, nueva versión y auditoría', () => {
  let pdfs: PdfsDeLaPrueba;
  let editor: Sesion;
  let administrador: Sesion;
  const sesiones: Sesion[] = [];
  // Los números de los documentos que crea la corrida (la base puede traer otros de corridas anteriores).
  let idA = 0;
  let idB = 0;
  let idC = 0;
  let expediente = '';

  test.beforeAll(async ({ browser }, testInfo) => {
    claveDeLaSiembra();
    pdfs = await generarPdfs(semillaDeLaCorrida());
    expediente = `EXP-E2E-${pdfs.semilla}`;
    console.log(`Semilla de la corrida: ${pdfs.semilla} (con FARO_E2E_SEMILLA=${pdfs.semilla} se repite el mismo texto)`);
    editor = await abrirSesion(browser, testInfo, 'editor');
    sesiones.push(editor);
  });

  test.afterEach(async () => {
    const testInfo = test.info();
    const hallazgos = sesiones.flatMap((s) => s.vigilante.hallazgos);
    if (testInfo.status !== testInfo.expectedStatus || hallazgos.length > 0) {
      await guardarEvidenciaDelFallo(sesiones, testInfo);
    }
    // Una página con un error de consola o una respuesta de error no provocada hace fallar el paso donde ocurrió.
    expect(hallazgos, 'Errores de consola, errores de página o respuestas ≥ 400 que la prueba no provocó').toEqual([]);
  });

  test.afterAll(async () => {
    for (const sesion of sesiones) {
      if (sesion.vigilante.provocadas.length > 0) {
        console.log(`Respuestas de error provocadas a propósito [${sesion.etiqueta}]: ${sesion.vigilante.provocadas.join(', ')}`);
      }
    }
    await cerrarSesiones(sesiones);
  });

  test('01 · Sin sesión la interfaz lleva al ingreso y una clave incorrecta se rechaza con un aviso', async () => {
    const { page, vigilante } = editor;
    await page.goto('/app/');
    await expect(page).toHaveURL(/\/app\/ingreso$/);
    await expect(page.getByRole('heading', { name: 'Ingreso', level: 1 })).toBeVisible();

    // Es también la prueba de que la guarda de origen deja pasar el POST de la propia interfaz: la respuesta es 401 (la
    // clave no sirve), no 403 `origen_no_permitido`. Con un 403 este paso fallaría por «respuesta inesperada».
    await vigilante.permitiendo([/^401 POST \/auth\/login$/], async () => {
      await ingresar(page, USUARIO_EDITOR, CLAVE_INCORRECTA);
      await expect(page.getByRole('alert')).toBeVisible();
    });
    await expect(page).toHaveURL(/\/app\/ingreso$/);
  });

  test('02 · El editor ingresa, llega al listado y su menú no trae usuarios ni auditoría', async () => {
    const { page, contexto } = editor;
    await ingresar(page, USUARIO_EDITOR, claveDeLaSiembra());
    await expect(page).toHaveURL(/\/app\/documentos$/);
    await expect(page.getByRole('heading', { name: 'Documentos', level: 1 })).toBeVisible();

    const menu = menuPrincipal(page);
    await expect(menu.getByRole('link', { name: 'Documentos' })).toBeVisible();
    await expect(menu.getByRole('link', { name: 'Cargar documento' })).toBeVisible();
    await expect(menu.getByRole('link', { name: 'Usuarios' })).toHaveCount(0);
    await expect(menu.getByRole('link', { name: 'Auditoría' })).toHaveCount(0);
    await expect(page.getByText('Editor Demo')).toBeVisible();

    // La sesión es una cookie que JavaScript no puede leer (ADR-003); la interfaz no guarda nada en el almacenamiento.
    const cookie = (await contexto.cookies()).find((c) => c.name === 'faro_sesion');
    expect(cookie, 'cookie de sesión').toMatchObject({ httpOnly: true, sameSite: 'Lax' });
  });

  test('03 · Carga del PDF original: queda como la versión 1, con la huella del archivo subido', async () => {
    const { page } = editor;
    await irACargar(page);
    await llenarFormularioDeCarga(page, { pdf: pdfs.original, titulo: TITULO_ORIGINAL, expediente });
    await page.getByRole('button', { name: 'Cargar documento' }).click();

    await expect(page.getByRole('heading', { name: TITULO_ORIGINAL, level: 1 })).toBeVisible();
    idA = await idDelDocumentoAbierto(page);
    await expect(page.getByText(/quedó como la versión 1/)).toBeVisible();

    const version1 = tarjetaDeVersion(page, 1);
    await expect(version1.getByText('Vigente')).toBeVisible();
    await expect(version1).toContainText(pdfs.original.nombre);
    await expect(version1).toContainText(pdfs.original.sha256.slice(0, 16));
  });

  test('04 · Un reescaneo del mismo documento avisa del duplicado probable y muestra la comparación', async () => {
    const { page, vigilante } = editor;
    await irACargar(page);
    await llenarFormularioDeCarga(page, { pdf: pdfs.reescaneos[0], titulo: TITULO_REESCANEO, expediente });

    await vigilante.permitiendo([/^409 POST \/documentos$/], async () => {
      await page.getByRole('button', { name: 'Cargar documento' }).click();
      await expect(pantallaDeDuplicado(page)).toBeVisible();
    });

    const existente = page.getByRole('region', { name: TITULO_ORIGINAL, exact: true });
    await expect(existente).toContainText('Ya existe en el sistema');
    await expect(existente).toContainText(expediente);
    // El autor llega de otra petición (el detalle del documento): esperarlo deja la pantalla ya quieta.
    await expect(existente).toContainText(USUARIO_EDITOR);

    const similitud = await existente.getByText(/de parecido en el texto/).innerText();
    const porcentaje = Number(/^(\d+) %/.exec(similitud)?.[1]);
    expect(porcentaje, `parecido mostrado: «${similitud}»`).toBeGreaterThanOrEqual(80);
    expect(porcentaje).toBeLessThanOrEqual(100);

    const nuevo = page.getByRole('region', { name: TITULO_REESCANEO, exact: true });
    await expect(nuevo).toContainText('Lo que intentas cargar');
    await expect(nuevo).toContainText(pdfs.reescaneos[0].nombre);

    // Con un solo candidato no hay nada que elegir: la lista aparece desde dos.
    await expect(listaDeCandidatos(page)).toHaveCount(0);
  });

  test('05 · Decide «es una versión nueva»: el documento original pasa a tener la versión 2 vigente', async () => {
    const { page } = editor;
    await page.getByRole('radio', { name: /Es una versión nueva/ }).check();
    await page.getByLabel(/^Motivo de la versión nueva/).fill('Reescaneo con mejor calidad de imagen');
    await page.getByRole('button', { name: 'Agregar como versión nueva' }).click();

    await expect(page).toHaveURL(new RegExp(`/app/documentos/${idA}$`));
    // Con «versión nueva» el documento conserva sus datos: el título que se escribió en este envío no se usa.
    await expect(page.getByRole('heading', { name: TITULO_ORIGINAL, level: 1, exact: true })).toBeVisible();
    await expect(page.getByText(/Se agregó el archivo como la versión 2 del documento/)).toBeVisible();

    const version2 = tarjetaDeVersion(page, 2);
    await expect(version2.getByText('Vigente')).toBeVisible();
    await expect(version2).toContainText('Reescaneo con mejor calidad de imagen');
    await expect(version2).toContainText(pdfs.reescaneos[0].nombre);
    await expect(version2).toContainText(pdfs.reescaneos[0].sha256.slice(0, 16));

    const version1 = tarjetaDeVersion(page, 1);
    await expect(version1).toBeVisible();
    await expect(version1.getByText('Vigente')).toHaveCount(0);
    await expect(version1).toContainText(pdfs.original.sha256.slice(0, 16));
  });

  test('06 · La versión vigente se descarga byte por byte igual a como se subió', async () => {
    const { page } = editor;
    const [descarga] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: 'Descargar la versión vigente (PDF)' }).click(),
    ]);
    expect(descarga.suggestedFilename()).toBe(pdfs.reescaneos[0].nombre);
    const recibido = await readFile(await descarga.path());
    expect(sha256(recibido)).toBe(pdfs.reescaneos[0].sha256);
  });

  test('07 · Con un candidato, «es otro documento» pide justificación y crea el documento B', async () => {
    const { page, vigilante } = editor;
    await irACargar(page);
    await llenarFormularioDeCarga(page, { pdf: pdfs.reescaneos[1], titulo: TITULO_B, expediente: `${expediente}-B` });
    await vigilante.permitiendo([/^409 POST \/documentos$/], async () => {
      await page.getByRole('button', { name: 'Cargar documento' }).click();
      await expect(pantallaDeDuplicado(page)).toBeVisible();
    });
    await expect(page.getByRole('region', { name: TITULO_ORIGINAL, exact: true })).toContainText(USUARIO_EDITOR);
    await expect(listaDeCandidatos(page)).toHaveCount(0);

    await page.getByRole('radio', { name: /Es otro documento/ }).check();
    await page.getByLabel(/^Justificación/).fill('Es el segundo lote del mismo contrato: usa la misma plantilla');
    await page.getByRole('button', { name: 'Cargar como documento nuevo' }).click();

    await expect(page.getByRole('heading', { name: TITULO_B, level: 1 })).toBeVisible();
    idB = await idDelDocumentoAbierto(page);
    expect(idB).not.toBe(idA);
    await expect(tarjetaDeVersion(page, 1).getByText('Vigente')).toBeVisible();
  });

  test('08 · Con dos candidatos, las opciones de la lista no se intersectan y su texto cabe (1280 y 360 px)', async () => {
    const { page, vigilante } = editor;
    await irACargar(page);
    await llenarFormularioDeCarga(page, { pdf: pdfs.reescaneos[2], titulo: TITULO_C, expediente: `${expediente}-C` });
    await vigilante.permitiendo([/^409 POST \/documentos$/], async () => {
      await page.getByRole('button', { name: 'Cargar documento' }).click();
      await expect(pantallaDeDuplicado(page)).toBeVisible();
    });
    await expect(listaDeCandidatos(page)).toBeVisible();
    // La pantalla se mide ya quieta: el documento elegido por omisión terminó de cargar su autor.
    await expect(page.locator('.comparacion__lado--existe')).toContainText(USUARIO_EDITOR);

    await afirmarListaDeCandidatos(page, 2, '2 candidatos a 1280 px');
    await cambiarAncho(page, 360, 740);
    await afirmarListaDeCandidatos(page, 2, '2 candidatos a 360 px');
    await cambiarAncho(page, 1280, 800);

    await page.getByRole('radio', { name: /Es otro documento/ }).check();
    await page.getByLabel(/^Justificación/).fill('Es el tercer lote del mismo contrato: usa la misma plantilla');
    await page.getByRole('button', { name: 'Cargar como documento nuevo' }).click();
    await expect(page.getByRole('heading', { name: TITULO_C, level: 1 })).toBeVisible();
    idC = await idDelDocumentoAbierto(page);
    expect(new Set([idA, idB, idC]).size).toBe(3);
  });

  test('09 · Con tres candidatos pasa lo mismo, elegir cada uno cambia la comparación y «es el mismo» no carga nada', async () => {
    const { page, vigilante } = editor;
    await irACargar(page);
    await llenarFormularioDeCarga(page, { pdf: pdfs.reescaneos[3], titulo: TITULO_D, expediente: `${expediente}-D` });
    await vigilante.permitiendo([/^409 POST \/documentos$/], async () => {
      await page.getByRole('button', { name: 'Cargar documento' }).click();
      await expect(pantallaDeDuplicado(page)).toBeVisible();
    });
    const lista = listaDeCandidatos(page);
    await expect(lista).toBeVisible();
    await expect(page.locator('.comparacion__lado--existe')).toContainText(USUARIO_EDITOR);

    await afirmarListaDeCandidatos(page, 3, '3 candidatos a 1280 px');
    await cambiarAncho(page, 360, 740);
    await afirmarListaDeCandidatos(page, 3, '3 candidatos a 360 px');
    await cambiarAncho(page, 1280, 800);

    // Cada candidato elegido muestra su propio documento en la comparación (el recuadro lleva el título que está entre «»).
    const opciones = lista.getByRole('radio');
    for (let i = 0; i < 3; i++) {
      await opciones.nth(i).check();
      const rotulo = await opciones.nth(i).evaluate((radio) => radio.closest('label')?.textContent ?? '');
      const titulo = /«(.+?)»/.exec(rotulo)?.[1];
      expect(titulo, `título dentro de «» en la opción ${i + 1}: «${rotulo}»`).toBeTruthy();
      await expect(page.getByRole('region', { name: titulo, exact: true })).toBeVisible();
    }

    // «Es el mismo documento» no llama a la API: lleva al documento elegido con un aviso (ADR-012 §6.1).
    await page.getByRole('radio', { name: /Es el mismo documento/ }).check();
    await page.getByRole('button', { name: 'No cargar el archivo' }).click();
    await expect(page.getByText(/No se cargó nada: el archivo ya estaba en el sistema como/)).toBeVisible();
    expect([idA, idB, idC]).toContain(await idDelDocumentoAbierto(page));
  });

  test('10 · El administrador consulta la auditoría y encuentra la carga, la versión nueva y la decisión', async ({ browser }, testInfo) => {
    administrador = await abrirSesion(browser, testInfo, 'administrador');
    sesiones.push(administrador);
    const { page } = administrador;

    await page.goto('/app/');
    await expect(page).toHaveURL(/\/app\/ingreso$/);
    await ingresar(page, USUARIO_ADMINISTRADOR, claveDeLaSiembra());
    await expect(page).toHaveURL(/\/app\/documentos$/);
    const menu = menuPrincipal(page);
    await expect(menu.getByRole('link', { name: 'Usuarios' })).toBeVisible();
    await menu.getByRole('link', { name: 'Auditoría' }).click();
    await expect(page.getByRole('heading', { name: 'Auditoría', level: 1 })).toBeVisible();

    await page.getByLabel('Número de documento').fill(String(idA));
    await page.getByRole('button', { name: 'Filtrar' }).click();
    await expect(page).toHaveURL(new RegExp(`/app/auditoria\\?documentoId=${idA}$`));
    await expect(page.getByRole('status').filter({ hasText: /eventos con estos filtros/ })).toHaveText('4 eventos con estos filtros');

    const evento = (titulo: string) =>
      page.getByRole('listitem').filter({ has: page.getByRole('heading', { level: 2, name: titulo, exact: true }) });

    const carga = evento('Carga de documento');
    await expect(carga).toHaveCount(1);
    await expect(carga).toContainText(`versión 1; sha256 ${pdfs.original.sha256.slice(0, 12)}`);

    const version = evento('Versión nueva');
    await expect(version).toHaveCount(1);
    await expect(version).toContainText(`versión 2; sha256 ${pdfs.reescaneos[0].sha256.slice(0, 12)}`);

    const decision = evento('Decisión ante un duplicado');
    await expect(decision).toHaveCount(1);
    await expect(decision).toContainText(`nueva_version del documento ${idA}; candidatos: ${idA} v1 (`);

    const descarga = evento('Descarga de documento');
    await expect(descarga).toHaveCount(1);
    await expect(descarga).toContainText('versión 2');

    // Los cuatro eventos son del editor que hizo el recorrido, no del administrador que los consulta.
    for (const tarjeta of [carga, version, decision, descarga]) {
      await expect(tarjeta).toContainText(USUARIO_EDITOR);
    }
  });

  test('11 · El editor no puede abrir la auditoría por la dirección', async () => {
    const { page } = editor;
    await page.goto('/app/auditoria');
    await expect(page.getByRole('heading', { name: 'No tienes permiso para ver esta pantalla', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Auditoría', level: 1 })).toHaveCount(0);
  });

  test('12 · La guarda de origen rechaza con 403 una petición que viene de otro origen', async ({ browser }, testInfo) => {
    const ajena = await abrirSesion(browser, testInfo, 'otro-origen');
    sesiones.push(ajena);
    const destino = `${String(testInfo.project.use.baseURL)}/auth/login`;
    const host = new URL(destino).host;

    // Un «sitio ajeno»: un servidor mínimo del propio test, en otro puerto del mismo equipo, cuya página trae un formulario
    // que apunta al ingreso de la API. Es el ataque clásico (CSRF): un sitio que hace que el navegador de la víctima envíe
    // un POST. Se envía como formulario y no con `fetch` a propósito: con `fetch` el propio navegador se defiende antes
    // (la política de contenido de la API y `Cross-Origin-Resource-Policy: same-origin` de helmet bloquean la petición o su
    // respuesta), y esas defensas no dejan ver si la guarda de origen del servidor respondió. Un formulario sí llega.
    const sitio = createServer((_peticion, respuesta) => {
      respuesta.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      respuesta.end(
        `<!doctype html><meta charset="utf-8"><title>Sitio ajeno de la prueba</title>` +
          `<form method="post" action="${destino}"><input type="hidden" name="usuario" value="otro.origen.demo"></form>`,
      );
    });
    await new Promise<void>((listo) => sitio.listen(0, '127.0.0.1', listo));
    try {
      const direccion = sitio.address();
      if (direccion === null || typeof direccion === 'string') throw new Error('El sitio ajeno no abrió un puerto');
      const origenAjeno = `http://127.0.0.1:${direccion.port}`;
      expect(origenAjeno).not.toBe(new URL(destino).origin);

      await ajena.page.goto(origenAjeno);
      const respuesta = await ajena.vigilante.permitiendo([/^403 POST \/auth\/login$/], async () => {
        const [recibida] = await Promise.all([
          ajena.page.waitForResponse((r) => r.url() === destino && r.request().method() === 'POST'),
          ajena.page.evaluate(() => document.forms[0].submit()),
        ]);
        return recibida;
      });

      // Mismo endpoint que el paso 01 (allí, 401 por la clave): aquí el rechazo es 403 por el origen, antes de mirar nada más.
      expect(respuesta.status()).toBe(403);
      expect(await respuesta.json()).toMatchObject({ statusCode: 403, codigo: 'origen_no_permitido' });
      const cabeceras = await respuesta.request().allHeaders();
      expect(cabeceras.origin, 'Origin que envió el navegador').toBe(origenAjeno);
      expect(cabeceras.host, 'Host al que llegó').toBe(host);
    } finally {
      await new Promise<void>((cerrado) => sitio.close(() => cerrado()));
    }
  });
});
