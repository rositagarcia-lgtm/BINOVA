const express = require('express');
const db = require('../db');
const { requireAuth, requireRol } = require('../middleware/auth');
const router = express.Router();

router.get('/actual', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT t.id, t.inicio, c.id AS carrito_id, c.codigo AS carrito_codigo
       FROM turnos t
       JOIN carritos c ON c.id = t.carrito_id
       WHERE t.usuario_id = $1 AND t.fin IS NULL`,
      [req.usuario.id]
    );
    res.json(rows[0] || null);
  } catch (e) { next(e); }
});

router.post('/', requireAuth, requireRol('operario'), async (req, res, next) => {
  try {
    const { codigo } = req.body;
    if (!codigo) {
      return res.status(400).json({ error: 'Falta codigo del carrito' });
    }

    const abierto = await db.query(
      `SELECT id FROM turnos WHERE usuario_id = $1 AND fin IS NULL`,
      [req.usuario.id]
    );
    if (abierto.rows.length > 0) {
      return res.status(409).json({ error: 'Ya tienes un turno abierto' });
    }

    const carrito = await db.query(
      `SELECT id FROM carritos WHERE codigo = $1 AND activo = true`,
      [codigo]
    );
    if (carrito.rows.length === 0) {
      return res.status(404).json({ error: 'Carrito no encontrado' });
    }
    const carritoId = carrito.rows[0].id;

    const enUso = await db.query(
      `SELECT id FROM turnos WHERE carrito_id = $1 AND fin IS NULL`,
      [carritoId]
    );
    if (enUso.rows.length > 0) {
      return res.status(409).json({ error: 'Ese carrito ya esta en uso' });
    }

    const { rows } = await db.query(
      `INSERT INTO turnos (usuario_id, carrito_id, inicio)
       VALUES ($1, $2, now())
       RETURNING id, usuario_id, carrito_id, inicio`,
      [req.usuario.id, carritoId]
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

router.patch('/:id/cerrar', requireAuth, async (req, res, next) => {
  try {
    if (!/^\d+$/.test(req.params.id)) {
      return res.status(400).json({ error: 'id invalido' });
    }

    const { rows } = await db.query(
      `UPDATE turnos SET fin = now()
       WHERE id = $1 AND usuario_id = $2 AND fin IS NULL
       RETURNING id, usuario_id, carrito_id, inicio, fin`,
      [req.params.id, req.usuario.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Turno no encontrado, ya cerrado, o no te pertenece' });
    }
    res.json(rows[0]);
  } catch (e) { next(e); }
});

router.patch('/:id/posicion', requireAuth, async (req, res, next) => {
  try {
    if (!/^\d+$/.test(req.params.id)) {
      return res.status(400).json({ error: 'id invalido' });
    }
    const lat = Number(req.body.lat);
    const lng = Number(req.body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'lat/lng invalidos' });
    }

    const turno = await db.query(
      `SELECT carrito_id FROM turnos WHERE id = $1 AND usuario_id = $2 AND fin IS NULL`,
      [req.params.id, req.usuario.id]
    );
    if (turno.rows.length === 0) {
      return res.status(404).json({ error: 'Turno no encontrado, cerrado, o no te pertenece' });
    }

    await db.query(
      `UPDATE carritos SET ult_lat = $1, ult_lng = $2, ult_posicion_en = now()
       WHERE id = $3`,
      [lat, lng, turno.rows[0].carrito_id]
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
