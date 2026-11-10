const express = require('express');
const { conflicto, noEncontrado, prohibido, validacion } = require('../errors');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, requireRol } = require('../middleware/auth');
const { liberarAlertasDeCarrito } = require('../services/alertas');
const { esId, normalizarCorreo, correoValido, texto, generarClave, paginacion } = require('../utils');
const { auditar } = require('../services/auditoria');
const router = express.Router();

const ROLES_CREABLES = ['admin', 'supervisor', 'operario'];

router.get('/', requireAuth, requireRol('admin', 'supervisor'), async (req, res, next) => {
  try {
    const { limite, desde } = paginacion(req.query);
    const { rows } = await db.query(
      `SELECT id, nombre, correo, rol, activo, creado_en
       FROM usuarios WHERE organizacion_id = $1
       ORDER BY nombre, id
       LIMIT $2 OFFSET $3`,
      [req.usuario.organizacion_id, limite, desde]
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
      return next(validacion('nombre y correo validos son obligatorios'));
    }
    if (!ROLES_CREABLES.includes(b.rol)) {
      return next(validacion('rol debe ser admin, supervisor u operario'));
    }

    const clave = generarClave();
    const hash = await bcrypt.hash(clave, 10);
    const { rows } = await db.query(
      `INSERT INTO usuarios (nombre, correo, clave_hash, rol, organizacion_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, nombre, correo, rol, activo`,
      [nombre, correo, hash, b.rol, req.usuario.organizacion_id]
    );
    await auditar({ usuario: req.usuario, accion: 'usuario_creado', entidad: 'usuario', entidadId: rows[0].id, detalle: { rol: b.rol } });
    res.status(201).json({ ...rows[0], clave_temporal: clave });
  } catch (e) { next(e); }
});

router.post('/:id/restablecer-clave', requireAuth, requireRol('admin', 'superadmin'), async (req, res, next) => {
  try {
    if (!esId(req.params.id)) {
      return next(validacion('id invalido'));
    }
    if (req.params.id === String(req.usuario.id)) {
      return next(validacion('Para cambiar tu propia clave usa /auth/cambiar-clave'));
    }

    const esSuperadmin = req.usuario.rol === 'superadmin';
    const { rows } = await db.query(
      `SELECT id, nombre, correo, rol, activo FROM usuarios
       WHERE id = $1 AND ($2::boolean OR organizacion_id = $3)`,
      [req.params.id, esSuperadmin, req.usuario.organizacion_id]
    );
    const u = rows[0];
    if (!u) {
      return next(noEncontrado('Usuario no encontrado'));
    }

    const permitidos = esSuperadmin
      ? ['admin', 'supervisor', 'operario', 'particular']
      : ['supervisor', 'operario'];
    if (!permitidos.includes(u.rol)) {
      return next(prohibido('No tienes permiso para restablecer la clave de ese usuario'));
    }
    if (!u.activo) {
      return next(conflicto('El usuario esta desactivado'));
    }

    const clave = generarClave();
    await db.tx(async (c) => {
      await c.query(`UPDATE usuarios SET clave_hash = $1 WHERE id = $2`, [await bcrypt.hash(clave, 10), u.id]);
      await c.query(`UPDATE invitaciones SET usada_en = now() WHERE usuario_id = $1 AND usada_en IS NULL`, [u.id]);
    });
    await auditar({ usuario: req.usuario, accion: 'clave_restablecida_por_admin', entidad: 'usuario', entidadId: u.id });
    res.json({ id: u.id, nombre: u.nombre, correo: u.correo, rol: u.rol, clave_temporal: clave });
  } catch (e) { next(e); }
});

router.patch('/:id', requireAuth, requireRol('admin'), async (req, res, next) => {
  try {
    if (!esId(req.params.id)) {
      return next(validacion('id invalido'));
    }
    if (typeof req.body?.activo !== 'boolean') {
      return next(validacion('activo debe ser true o false'));
    }
    if (req.params.id === String(req.usuario.id)) {
      return next(validacion('No puedes cambiar tu propio estado'));
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
      return next(noEncontrado('Usuario no encontrado'));
    }
    await auditar({ usuario: req.usuario, accion: usuario.activo ? 'usuario_activado' : 'usuario_desactivado', entidad: 'usuario', entidadId: usuario.id });
    res.json(usuario);
  } catch (e) { next(e); }
});

module.exports = router;
