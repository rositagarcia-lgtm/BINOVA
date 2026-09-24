const express = require('express');
const { interno, noEncontrado, tokenInvalido, validacion } = require('../errors');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const db = require('../db');
const { num } = require('../utils');
const { evaluarLectura } = require('../services/alertas');
const { limitador } = require('../middleware/limitadores');
const router = express.Router();

const limitePorRed = limitador(60 * 1000, 600, 'Demasiadas lecturas desde esta red');
const limitePorDispositivo = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas lecturas de este dispositivo', codigo: 'demasiadas_solicitudes' },
  keyGenerator: (req) => (typeof req.body?.device_id === 'string' && req.body.device_id
    ? 'dispositivo:' + req.body.device_id.slice(0, 80)
    : ipKeyGenerator(req.ip)),
});

function enteroOpcional(valor, min, max) {
  if (valor === undefined || valor === null) return { valor: null };
  const n = num(valor);
  if (!Number.isFinite(n)) return { error: true };
  const redondeado = Math.round(n);
  if (redondeado < min || redondeado > max) return { error: true };
  return { valor: redondeado };
}

router.post('/', limitePorRed, limitePorDispositivo, async (req, res, next) => {
  try {
    const { device_id, distancia_cm, bateria, rssi } = req.body ?? {};

    if (!device_id || distancia_cm === undefined) {
      return next(validacion('Faltan device_id o distancia_cm'));
    }

    const distancia = num(distancia_cm);
    if (!Number.isFinite(distancia) || distancia < 0) {
      return next(validacion('distancia_cm invalida'));
    }
    const bat = enteroOpcional(bateria, 0, 100);
    if (bat.error) {
      return next(validacion('bateria debe estar entre 0 y 100'));
    }
    const sen = enteroOpcional(rssi, -200, 0);
    if (sen.error) {
      return next(validacion('rssi debe estar entre -200 y 0'));
    }

    const { rows } = await db.query(
      `SELECT c.id, c.altura_cm, c.umbral_ambar, c.umbral_rojo, c.token
       FROM contenedores c
       LEFT JOIN organizaciones o ON o.id = c.organizacion_id
       WHERE c.device_id = $1 AND c.activo = true
         AND (c.organizacion_id IS NULL OR o.estado = 'activa')`,
      [device_id]
    );
    if (rows.length === 0) {
      return next(noEncontrado('Dispositivo no registrado'));
    }

    const c = rows[0];

    const enviado = (req.headers.authorization || '').replace('Bearer ', '');
    if (!c.token || c.token !== enviado) {
      return next(tokenInvalido('Token invalido'));
    }

    const altura = Number(c.altura_cm);
    if (!Number.isFinite(altura) || altura <= 0) {
      return next(interno('Contenedor con altura_cm invalida'));
    }

    let nivel = Math.round(((altura - distancia) / altura) * 100);
    nivel = Math.max(0, Math.min(100, nivel));

    const estado = nivel >= c.umbral_rojo ? 'rojo'
                 : nivel >= c.umbral_ambar ? 'ambar'
                 : 'verde';

    await db.query(
      `INSERT INTO lecturas (contenedor_id, distancia_cm, nivel, bateria, rssi)
       VALUES ($1, $2, $3, $4, $5)`,
      [c.id, distancia, nivel, bat.valor, sen.valor]
    );

    await db.query(
      `UPDATE contenedores
         SET nivel_actual = $1, estado = $2, ultima_lectura_en = now()
       WHERE id = $3`,
      [nivel, estado, c.id]
    );

    try {
      await evaluarLectura({ contenedorId: c.id, nivel, estado, bateria: bat.valor });
    } catch (e) {
      console.error('Error al evaluar alertas:', e.message);
    }

    res.json({ ok: true, nivel, estado, intervalo_seg: 900 });
  } catch (e) { next(e); }
});

module.exports = router;
