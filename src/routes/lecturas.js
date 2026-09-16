const express = require('express');
const db = require('../db');
const router = express.Router();

router.post('/', async (req, res, next) => {
  try {
    const { device_id, distancia_cm, bateria, rssi } = req.body;

    if (!device_id || distancia_cm === undefined) {
      return res.status(400).json({ error: 'Faltan device_id o distancia_cm' });
    }

    const distancia = Number(distancia_cm);
    if (!Number.isFinite(distancia)) {
      return res.status(400).json({ error: 'distancia_cm invalida' });
    }

    const { rows } = await db.query(
      `SELECT id, altura_cm, umbral_ambar, umbral_rojo, token
       FROM contenedores WHERE device_id = $1 AND activo = true`,
      [device_id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Dispositivo no registrado' });
    }

    const c = rows[0];

    const enviado = (req.headers.authorization || '').replace('Bearer ', '');
    if (!c.token || c.token !== enviado) {
      return res.status(401).json({ error: 'Token invalido' });
    }

    const altura = Number(c.altura_cm);
    if (!Number.isFinite(altura) || altura <= 0) {
      return res.status(500).json({ error: 'Contenedor con altura_cm invalida' });
    }

    let nivel = Math.round(((altura - distancia) / altura) * 100);
    nivel = Math.max(0, Math.min(100, nivel));

    const estado = nivel >= c.umbral_rojo ? 'rojo'
                 : nivel >= c.umbral_ambar ? 'ambar'
                 : 'verde';

    await db.query(
      `INSERT INTO lecturas (contenedor_id, distancia_cm, nivel, bateria, rssi)
       VALUES ($1, $2, $3, $4, $5)`,
      [c.id, distancia, nivel, bateria ?? null, rssi ?? null]
    );

    await db.query(
      `UPDATE contenedores
         SET nivel_actual = $1, estado = $2, ultima_lectura_en = now()
       WHERE id = $3`,
      [nivel, estado, c.id]
    );

    res.json({ ok: true, nivel, estado, intervalo_seg: 900 });
  } catch (e) { next(e); }
});

module.exports = router;