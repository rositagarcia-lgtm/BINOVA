const express = require('express');
const db = require('../db');
const { requireAuth, requireRol } = require('../middleware/auth');
const router = express.Router();

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT id, codigo, placa, descripcion, capacidad_l,
             ult_lat, ult_lng, ult_posicion_en
      FROM carritos
      WHERE activo = true
      ORDER BY codigo
    `);
    res.json(rows);
  } catch (e) { next(e); }
});

router.post('/', requireAuth, requireRol('admin', 'supervisor'), async (req, res, next) => {
  try {
    const { codigo, placa, descripcion, capacidad_l } = req.body;
    if (!codigo) {
      return res.status(400).json({ error: 'Falta codigo' });
    }

    const { rows } = await db.query(
      `INSERT INTO carritos (codigo, placa, descripcion, capacidad_l, activo)
       VALUES ($1, $2, $3, $4, true)
       RETURNING id, codigo, placa, descripcion, capacidad_l`,
      [codigo, placa ?? null, descripcion ?? null, capacidad_l ?? null]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ error: 'Ya existe un carrito con ese codigo o placa' });
    }
    next(e);
  }
});

module.exports = router;
