const express = require('express');
const { validacion } = require('../errors');
const db = require('../db');
const { requireAuth, requireRol } = require('../middleware/auth');
const { esId, texto, paginacion } = require('../utils');
const router = express.Router();

router.get('/', requireAuth, requireRol('superadmin', 'admin'), async (req, res, next) => {
  try {
    const { limite, desde } = paginacion(req.query, { porDefecto: 100, max: 500 });
    const esSuper = req.usuario.rol === 'superadmin';
    let org = esSuper ? (req.query.organizacion_id ?? null) : req.usuario.organizacion_id;
    if (org !== null && !esId(org)) {
      return next(validacion('organizacion_id invalido'));
    }
    const accion = req.query.accion === undefined ? null : texto(req.query.accion, 60);
    const { rows } = await db.query(
      `SELECT a.id, a.creado_en, a.accion, a.entidad, a.entidad_id, a.detalle, a.organizacion_id, u.nombre AS usuario
       FROM auditoria a
       LEFT JOIN usuarios u ON u.id = a.usuario_id
       WHERE ($1::bigint IS NULL OR a.organizacion_id = $1)
         AND ($2::text IS NULL OR a.accion = $2)
       ORDER BY a.creado_en DESC, a.id DESC
       LIMIT $3 OFFSET $4`,
      [org, accion, limite, desde]
    );
    res.json(rows);
  } catch (e) { next(e); }
});

module.exports = router;
