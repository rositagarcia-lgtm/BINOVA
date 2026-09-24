const jwt = require('jsonwebtoken');
const db = require('../db');
const { noAutenticado, tokenInvalido, prohibido, orgInactiva } = require('../errors');

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return next(noAutenticado('Falta token de autenticacion'));
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch (e) {
    return next(tokenInvalido('Token invalido o expirado'));
  }

  try {
    const { rows } = await db.query(
      `SELECT u.id, u.nombre, u.correo, u.rol, u.organizacion_id, o.estado AS org_estado
       FROM usuarios u
       LEFT JOIN organizaciones o ON o.id = u.organizacion_id
       WHERE u.id = $1 AND u.activo = true`,
      [payload.id]
    );
    const u = rows[0];
    if (!u) {
      return next(noAutenticado('Usuario no valido'));
    }
    if (u.rol !== 'superadmin' && u.org_estado !== 'activa') {
      return next(orgInactiva('Organizacion no activa'));
    }
    req.usuario = {
      id: u.id,
      nombre: u.nombre,
      correo: u.correo,
      rol: u.rol,
      organizacion_id: u.organizacion_id,
    };
    next();
  } catch (e) { next(e); }
}

function requireRol(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.usuario.rol)) {
      return next(prohibido('No tienes permiso para esta accion'));
    }
    next();
  };
}

module.exports = { requireAuth, requireRol };
