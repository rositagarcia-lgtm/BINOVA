const express = require('express');
const db = require('../db');
const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT c.id, c.codigo, c.nombre, c.lat, c.lng,
             c.nivel_actual, c.estado, c.ultima_lectura_en,
             z.nombre AS zona
      FROM contenedores c
      LEFT JOIN zonas z ON z.id = c.zona_id
      WHERE c.activo = true
      ORDER BY c.nivel_actual DESC NULLS LAST
    `);
    res.json(rows);
  } catch (e) { next(e); }
});

router.get('/:id/historico', async (req, res, next) => {
  try {
    if (!/^\d+$/.test(req.params.id)) {
      return res.status(400).json({ error: 'id invalido' });
    }
    const { rows } = await db.query(`
      SELECT nivel, bateria, medido_en
      FROM lecturas
      WHERE contenedor_id = $1
      ORDER BY medido_en DESC
      LIMIT 200
    `, [req.params.id]);
    res.json(rows);
  } catch (e) { next(e); }
});

module.exports = router;