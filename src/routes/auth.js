const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos, intenta de nuevo mas tarde' },
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { correo, clave } = req.body;
    if (!correo || !clave) {
      return res.status(400).json({ error: 'Faltan correo o clave' });
    }

    const { rows } = await db.query(
      `SELECT id, nombre, correo, clave_hash, rol
       FROM usuarios WHERE correo = $1 AND activo = true`,
      [correo]
    );
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Credenciales invalidas' });
    }

    const u = rows[0];
    const ok = await bcrypt.compare(clave, u.clave_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Credenciales invalidas' });
    }

    const token = jwt.sign(
      { id: u.id, nombre: u.nombre, correo: u.correo, rol: u.rol },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );

    res.json({
      token,
      usuario: { id: u.id, nombre: u.nombre, correo: u.correo, rol: u.rol },
    });
  } catch (e) { next(e); }
});

module.exports = router;
