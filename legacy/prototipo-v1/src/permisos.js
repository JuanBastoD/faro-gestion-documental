const { registrarAuditoria } = require('./documentos');

const PERMISOS = {
  cargar: ['administrador', 'editor'],
  versionar: ['administrador', 'editor'],
  auditar: ['administrador'],
};

function puede(usuario, accion) {
  return Boolean(usuario) && PERMISOS[accion].includes(usuario.rol);
}

function exigirSesion(req, res, next) {
  if (!req.session.usuario) return res.redirect('/login');
  return next();
}

/** Valida en el servidor; ocultar un botón en la vista no protege nada. */
function exigirPermiso(accion) {
  return (req, res, next) => {
    if (puede(req.session.usuario, accion)) return next();
    registrarAuditoria(req.app.locals.db, {
      usuarioId: req.session.usuario.id,
      accion: 'acceso_denegado',
      detalle: `${req.method} ${req.originalUrl}`,
    });
    return res.status(403).render('error', {
      titulo: 'Acceso denegado',
      mensaje: `Su rol (${req.session.usuario.rol}) no permite realizar esta acción. El intento quedó registrado.`,
    });
  };
}

module.exports = { exigirPermiso, exigirSesion, puede };
