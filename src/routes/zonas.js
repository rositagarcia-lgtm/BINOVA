const express = require('express');
const { validacion } = require('../errors');
const db = require('../db');
const { requireAuth, requireRol } = require('../middleware/auth');
const { texto } = require('../utils');
const router = express.Router();

const ROLES_ORG = ['admin', 'supervisor', 'operario', 'particular'];

router.get('/', requireAuth, requireRol(...ROLES_ORG), async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT id, nombre, descripcion FROM zonas WHERE organizacion_id = $1 ORDER BY nombre`,
      [req.usuario.organizacion_id]
    );
    res.json(rows);
  } catch (e) { next(e); }
});

router.post('/', requireAuth, requireRol('admin'), async (req, res, next) => {
  try {
    const nombre = texto(req.body?.nombre, 120);
    if (!nombre) {
      return next(validacion('Falta nombre'));
    }
    const { rows } = await db.query(
      `INSERT INTO zonas (nombre, descripcion, organizacion_id)
       VALUES ($1, $2, $3)
       RETURNING id, nombre, descripcion`,
      [nombre, texto(req.body.descripcion, 500), req.usuario.organizacion_id]
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

module.exports = router;
