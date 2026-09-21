const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, requireRol } = require('../middleware/auth');
const { liberarAlertasDeCarrito } = require('../services/alertas');
const { esId, normalizarCorreo, correoValido, texto, generarClave } = require('../utils');
const router = express.Router();

const ROLES_CREABLES = ['admin', 'supervisor', 'operario'];

router.get('/', requireAuth, requireRol('admin', 'supervisor'), async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT id, nombre, correo, rol, activo, creado_en
       FROM usuarios WHERE organizacion_id = $1
       ORDER BY nombre`,
      [req.usuario.organizacion_id]
    );
    res.json(rows);
  } catch (e) { next(e); }
});

router.post('/', requireAuth, requireRol('admin'), async (req, res, next) => {
  try {
    const b = req.body ?? {};
    const nombre = texto(b.nombre, 120);
    const correo = normalizarCorreo(b.correo);
    if (!nombre || !correoValido(correo)) {
      return res.status(400).json({ error: 'nombre y correo validos son obligatorios' });
    }
    if (!ROLES_CREABLES.includes(b.rol)) {
      return res.status(400).json({ error: 'rol debe ser admin, supervisor u operario' });
    }

    const clave = generarClave();
    const hash = await bcrypt.hash(clave, 10);
    const { rows } = await db.query(
      `INSERT INTO usuarios (nombre, correo, clave_hash, rol, organizacion_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, nombre, correo, rol, activo`,
      [nombre, correo, hash, b.rol, req.usuario.organizacion_id]
    );
    res.status(201).json({ ...rows[0], clave_temporal: clave });
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ error: 'Ya existe un usuario con ese correo' });
    }
    next(e);
  }
});

router.patch('/:id', requireAuth, requireRol('admin'), async (req, res, next) => {
  try {
    if (!esId(req.params.id)) {
      return res.status(400).json({ error: 'id invalido' });
    }
    if (typeof req.body?.activo !== 'boolean') {
      return res.status(400).json({ error: 'activo debe ser true o false' });
    }
    if (req.params.id === String(req.usuario.id)) {
      return res.status(400).json({ error: 'No puedes cambiar tu propio estado' });
    }

    const usuario = await db.tx(async (c) => {
      const { rows } = await c.query(
        `UPDATE usuarios SET activo = $1
         WHERE id = $2 AND organizacion_id = $3
         RETURNING id, nombre, correo, rol, activo`,
        [req.body.activo, req.params.id, req.usuario.organizacion_id]
      );
      if (rows.length > 0 && !req.body.activo) {
        const cerrados = await c.query(
          `UPDATE turnos SET fin = now() WHERE usuario_id = $1 AND fin IS NULL RETURNING carrito_id`,
          [req.params.id]
        );
        for (const t of cerrados.rows) {
          await liberarAlertasDeCarrito(t.carrito_id, c);
        }
      }
      return rows[0];
    });

    if (!usuario) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    res.json(usuario);
  } catch (e) { next(e); }
});

module.exports = router;
