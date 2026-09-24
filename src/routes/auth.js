const express = require('express');
const { credenciales, orgInactiva, validacion, cuentaPendiente, invitacionInvalida, invitacionExpirada, invitacionUsada } = require('../errors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { limitador } = require('../middleware/limitadores');
const { normalizarCorreo, correoValido, claveValida, texto } = require('../utils');
const { buscarPorToken, consumir } = require('../services/invitaciones');
const router = express.Router();

const HASH_FALSO = bcrypt.hashSync('clave-falsa-para-igualar-tiempos', 10);
const limiteLogin = limitador(15 * 60 * 1000, 10, 'Demasiados intentos, intenta de nuevo mas tarde');
const limiteRegistro = limitador(60 * 60 * 1000, 5, 'Demasiados registros, intenta de nuevo mas tarde');
const limiteClave = limitador(15 * 60 * 1000, 10, 'Demasiados intentos, intenta de nuevo mas tarde');
const limiteInvitacion = limitador(15 * 60 * 1000, 20, 'Demasiados intentos, intenta de nuevo mas tarde');

router.post('/login', limiteLogin, async (req, res, next) => {
  try {
    const correo = normalizarCorreo(req.body?.correo);
    const clave = req.body?.clave;
    if (!correo || typeof clave !== 'string' || !clave) {
      return next(validacion('Faltan correo o clave'));
    }

    const { rows } = await db.query(
      `SELECT u.id, u.nombre, u.correo, u.clave_hash, u.rol, u.organizacion_id,
              o.nombre AS org_nombre, o.tipo AS org_tipo, o.estado AS org_estado
       FROM usuarios u
       LEFT JOIN organizaciones o ON o.id = u.organizacion_id
       WHERE lower(u.correo) = $1 AND u.activo = true`,
      [correo]
    );
    const u = rows[0];

    const ok = await bcrypt.compare(clave, u ? u.clave_hash : HASH_FALSO);
    if (!u || !ok) {
      return next(credenciales('Credenciales invalidas'));
    }
    if (u.rol !== 'superadmin' && u.org_estado !== 'activa') {
      return next(orgInactiva('Organizacion no activa'));
    }

    const pendiente = await db.query(
      `SELECT 1 FROM invitaciones
       WHERE usuario_id = $1 AND usada_en IS NULL AND expira_en > now()`,
      [u.id]
    );
    if (pendiente.rows.length > 0) {
      return next(cuentaPendiente('Debes crear tu clave con el enlace que te enviamos'));
    }

    const token = jwt.sign(
      { id: u.id, nombre: u.nombre, correo: u.correo, rol: u.rol, organizacion_id: u.organizacion_id },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );

    res.json({
      token,
      usuario: {
        id: u.id,
        nombre: u.nombre,
        correo: u.correo,
        rol: u.rol,
        organizacion: u.organizacion_id
          ? { id: u.organizacion_id, nombre: u.org_nombre, tipo: u.org_tipo }
          : null,
      },
    });
  } catch (e) { next(e); }
});

router.post('/registro-particular', limiteRegistro, async (req, res, next) => {
  try {
    const b = req.body ?? {};
    const nombre = texto(b.nombre, 120);
    const correo = normalizarCorreo(b.correo);
    if (!nombre || !correoValido(correo)) {
      return next(validacion('nombre y correo validos son obligatorios'));
    }
    if (!claveValida(b.clave)) {
      return next(validacion('La clave debe tener entre 8 y 72 caracteres'));
    }

    const hash = await bcrypt.hash(b.clave, 10);
    const usuario = await db.tx(async (c) => {
      const org = await c.query(
        `INSERT INTO organizaciones (nombre, tipo, estado, aprobado_en)
         VALUES ($1, 'individual', 'activa', now()) RETURNING id`,
        [nombre]
      );
      const u = await c.query(
        `INSERT INTO usuarios (nombre, correo, clave_hash, rol, organizacion_id)
         VALUES ($1, $2, $3, 'particular', $4)
         RETURNING id, nombre, correo, rol, organizacion_id`,
        [nombre, correo, hash, org.rows[0].id]
      );
      return u.rows[0];
    });
    res.status(201).json({ usuario });
  } catch (e) { next(e); }
});

router.get('/invitacion', limiteInvitacion, async (req, res, next) => {
  try {
    const token = texto(req.query.token, 100);
    if (!token) {
      return next(validacion('Falta token'));
    }
    const inv = await buscarPorToken(db, token);
    if (!inv) {
      return next(invitacionInvalida('Enlace invalido'));
    }
    if (inv.usada_en) {
      return next(invitacionUsada('Este enlace ya fue utilizado'));
    }
    if (new Date(inv.expira_en) <= new Date()) {
      return next(invitacionExpirada('Este enlace expiro. Pide uno nuevo.'));
    }
    if (inv.org_estado !== 'activa') {
      return next(orgInactiva('Organizacion no activa'));
    }
    res.json({
      nombre: inv.nombre,
      correo: inv.correo,
      organizacion: inv.org_nombre,
    });
  } catch (e) { next(e); }
});

router.post('/activar-invitacion', limiteInvitacion, async (req, res, next) => {
  try {
    const b = req.body ?? {};
    const token = texto(b.token, 100);
    if (!token) {
      return next(validacion('Falta token'));
    }
    if (!claveValida(b.clave)) {
      return next(validacion('La clave debe tener entre 8 y 72 caracteres'));
    }

    await db.tx(async (c) => {
      const inv = await buscarPorToken(c, token, { bloquear: true });
      if (!inv) throw invitacionInvalida('Enlace invalido');
      if (inv.usada_en) throw invitacionUsada('Este enlace ya fue utilizado');
      if (new Date(inv.expira_en) <= new Date()) {
        throw invitacionExpirada('Este enlace expiro. Pide uno nuevo.');
      }
      if (inv.org_estado !== 'activa') throw orgInactiva('Organizacion no activa');

      const hash = await bcrypt.hash(b.clave, 10);
      await c.query(
        `UPDATE usuarios SET clave_hash = $1, activo = true WHERE id = $2`,
        [hash, inv.usuario_id]
      );
      await consumir(c, inv.id);
    });
    res.json({ ok: true, mensaje: 'Clave creada. Ya puedes iniciar sesion.' });
  } catch (e) { next(e); }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT id, nombre, tipo FROM organizaciones WHERE id = $1`,
      [req.usuario.organizacion_id]
    );
    res.json({ usuario: req.usuario, organizacion: rows[0] || null });
  } catch (e) { next(e); }
});

router.post('/cambiar-clave', limiteClave, requireAuth, async (req, res, next) => {
  try {
    const b = req.body ?? {};
    if (typeof b.clave_actual !== 'string' || !claveValida(b.clave_nueva)) {
      return next(validacion('La clave nueva debe tener entre 8 y 72 caracteres'));
    }
    if (b.clave_nueva === b.clave_actual) {
      return next(validacion('La clave nueva debe ser distinta a la actual'));
    }

    const { rows } = await db.query(`SELECT clave_hash FROM usuarios WHERE id = $1`, [req.usuario.id]);
    const ok = await bcrypt.compare(b.clave_actual, rows[0].clave_hash);
    if (!ok) {
      return next(credenciales('Clave actual incorrecta'));
    }

    const hash = await bcrypt.hash(b.clave_nueva, 10);
    await db.query(`UPDATE usuarios SET clave_hash = $1 WHERE id = $2`, [hash, req.usuario.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
