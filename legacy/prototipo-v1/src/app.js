const crypto = require('node:crypto');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const doc = require('./documentos');
const { exigirPermiso, exigirSesion, puede } = require('./permisos');

const TAMANO_MAXIMO = 20 * 1024 * 1024;

const formatoFecha = new Intl.DateTimeFormat('es-CO', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota',
});

function renderError(res, status, titulo, mensaje) {
  return res.status(status).render('error', { titulo, mensaje });
}

/** Valida el archivo recibido y corrige la codificación de su nombre. */
function leerArchivo(req) {
  if (!req.file) return { error: 'Debe adjuntar un archivo PDF.' };
  if (!doc.esPdf(req.file.buffer)) return { error: 'El archivo adjunto no es un PDF válido.' };
  const nombre = path.basename(Buffer.from(req.file.originalname, 'latin1').toString('utf8'));
  return { archivo: { nombre, buffer: req.file.buffer } };
}

function responderDuplicado(req, res, duplicado) {
  doc.registrarAuditoria(req.app.locals.db, {
    usuarioId: req.session.usuario.id,
    accion: 'duplicado_detectado',
    documentoId: duplicado.documento_id,
    detalle: `Coincide con v${duplicado.numero}`,
  });
  return res.status(409).render('duplicado', { titulo: 'Documento ya digitalizado', duplicado });
}

function crearApp({ db, uploadsDir, secreto = crypto.randomBytes(32).toString('hex') }) {
  const app = express();
  const carga = multer({ storage: multer.memoryStorage(), limits: { fileSize: TAMANO_MAXIMO } });

  app.locals.db = db;
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.disable('x-powered-by');

  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use(express.urlencoded({ extended: false }));
  app.use(session({
    secret: secreto,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax' },
  }));
  app.use((req, res, next) => {
    res.locals.usuario = req.session.usuario || null;
    res.locals.puede = (accion) => puede(req.session.usuario, accion);
    res.locals.fecha = (iso) => formatoFecha.format(new Date(iso));
    next();
  });

  app.get('/login', (req, res) => {
    if (req.session.usuario) return res.redirect('/');
    return res.render('login', { titulo: 'Ingresar', error: null });
  });

  app.post('/login', (req, res, next) => {
    const nombreUsuario = String(req.body.usuario || '').trim();
    const encontrado = db.prepare('SELECT * FROM usuarios WHERE usuario = ?').get(nombreUsuario);
    if (!encontrado || !bcrypt.compareSync(String(req.body.clave || ''), encontrado.clave_hash)) {
      doc.registrarAuditoria(db, { accion: 'ingreso_fallido', detalle: nombreUsuario.slice(0, 80) });
      return res.status(401).render('login', { titulo: 'Ingresar', error: 'Usuario o contraseña incorrectos.' });
    }
    return req.session.regenerate((error) => {
      if (error) return next(error);
      req.session.usuario = {
        id: encontrado.id, usuario: encontrado.usuario, nombre: encontrado.nombre, rol: encontrado.rol,
      };
      doc.registrarAuditoria(db, { usuarioId: encontrado.id, accion: 'ingreso' });
      return res.redirect('/');
    });
  });

  app.use(exigirSesion);

  app.post('/logout', (req, res, next) => {
    req.session.destroy((error) => (error ? next(error) : res.redirect('/login')));
  });

  app.get('/', (req, res) => {
    const texto = String(req.query.q || '').trim();
    const serieId = Number.parseInt(req.query.serie, 10) || null;
    res.render('listado', {
      titulo: 'Repositorio documental',
      documentos: doc.buscarDocumentos(db, { texto, serieId }),
      series: doc.listarSeries(db),
      texto,
      serieId,
    });
  });

  app.get('/documentos/nuevo', exigirPermiso('cargar'), (req, res) => {
    res.render('nuevo', { titulo: 'Cargar documento', series: doc.listarSeries(db) });
  });

  app.post('/documentos', exigirPermiso('cargar'), carga.single('archivo'), (req, res) => {
    const titulo = String(req.body.titulo || '').trim();
    const expediente = String(req.body.expediente || '').trim();
    const fecha = String(req.body.fecha || '');
    const serieId = Number.parseInt(req.body.serie, 10);
    if (!titulo || !expediente || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !doc.serieValida(db, serieId)) {
      return renderError(res, 400, 'Datos incompletos', 'Revise título, expediente, fecha y serie documental.');
    }
    const { archivo, error } = leerArchivo(req);
    if (error) return renderError(res, 400, 'Archivo no válido', error);

    const resultado = doc.crearDocumento(
      db, uploadsDir, { titulo, expediente, fecha, serieId }, archivo, req.session.usuario.id
    );
    if (resultado.duplicado) return responderDuplicado(req, res, resultado.duplicado);
    return res.redirect(`/documentos/${resultado.id}`);
  });

  app.get('/documentos/:id', (req, res) => {
    const documento = doc.obtenerDocumento(db, Number.parseInt(req.params.id, 10));
    if (!documento) return renderError(res, 404, 'No encontrado', 'El documento no existe.');
    return res.render('detalle', {
      titulo: documento.titulo,
      documento,
      versiones: doc.listarVersiones(db, documento.id),
    });
  });

  app.post('/documentos/:id/versiones', exigirPermiso('versionar'), carga.single('archivo'), (req, res) => {
    const documento = doc.obtenerDocumento(db, Number.parseInt(req.params.id, 10));
    if (!documento) return renderError(res, 404, 'No encontrado', 'El documento no existe.');
    const motivo = String(req.body.motivo || '').trim();
    if (!motivo) return renderError(res, 400, 'Datos incompletos', 'Indique el motivo de la nueva versión.');
    const { archivo, error } = leerArchivo(req);
    if (error) return renderError(res, 400, 'Archivo no válido', error);

    const resultado = doc.agregarVersion(db, uploadsDir, documento.id, archivo, motivo, req.session.usuario.id);
    if (resultado.duplicado) return responderDuplicado(req, res, resultado.duplicado);
    return res.redirect(`/documentos/${documento.id}`);
  });

  app.get('/versiones/:id/archivo', (req, res, next) => {
    const version = doc.obtenerVersion(db, Number.parseInt(req.params.id, 10));
    if (!version) return renderError(res, 404, 'No encontrado', 'La versión no existe.');
    doc.registrarAuditoria(db, {
      usuarioId: req.session.usuario.id,
      accion: 'descarga',
      documentoId: version.documento_id,
      detalle: `v${version.numero}`,
    });
    return res.download(path.resolve(uploadsDir, version.archivo), version.nombre_original, (error) => {
      if (error && !res.headersSent) next(error);
    });
  });

  app.get('/auditoria', exigirPermiso('auditar'), (req, res) => {
    res.render('auditoria', { titulo: 'Registro de auditoría', eventos: doc.listarAuditoria(db) });
  });

  app.use((req, res) => renderError(res, 404, 'No encontrado', 'La página solicitada no existe.'));

  // eslint-disable-next-line no-unused-vars -- Express identifica este middleware por sus cuatro parámetros.
  app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
      const mensaje = error.code === 'LIMIT_FILE_SIZE'
        ? 'El archivo supera el máximo de 20 MB.'
        : 'No se pudo procesar el archivo adjunto.';
      return renderError(res, 400, 'Archivo no válido', mensaje);
    }
    console.error(error);
    return renderError(res, 500, 'Error interno', 'Ocurrió un error inesperado.');
  });

  return app;
}

module.exports = { crearApp };
