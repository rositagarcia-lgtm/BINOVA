const express = require('express');
const { conflicto, noEncontrado, validacion } = require('../errors');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, requireRol } = require('../middleware/auth');
const { limitador } = require('../middleware/limitadores');
const { esId, normalizarCorreo, correoValido, texto, generarClave } = require('../utils');
const { emitir } = require('../services/invitaciones');
const { enviarSolicitudRecibida, enviarAccesoListo, linkActivacion } = require('../services/correo');
const router = express.Router();

const limiteSolicitud = limitador(60 * 60 * 1000, 5, 'Demasiadas solicitudes, intenta de nuevo mas tarde');

const ESTADOS = ['pendiente', 'activa', 'suspendida', 'rechazada'];
const TRANSICIONES = {
  rechazada: ['pendiente'],
  suspendida: ['activa'],
  activa: ['suspendida'],
};

router.post('/solicitud', limiteSolicitud, async (req, res, next) => {
  try {
    const b = req.body ?? {};
    const nombre = texto(b.nombre, 120);
    const contactoNombre = texto(b.contacto_nombre, 120);
    const contactoCorreo = normalizarCorreo(b.contacto_correo);
    if (!nombre || !contactoNombre || !correoValido(contactoCorreo)) {
      return next(validacion('nombre, contacto_nombre y contacto_correo validos son obligatorios'));
    }

    await db.query(
      `INSERT INTO organizaciones (nombre, tipo, estado, contacto_nombre, contacto_correo, mensaje)
       VALUES ($1, 'empresa', 'pendiente', $2, $3, $4)`,
      [nombre, contactoNombre, contactoCorreo, texto(b.mensaje, 1000)]
    );
    const enviado = await enviarSolicitudRecibida({
      nombre: contactoNombre,
      correo: contactoCorreo,
      organizacion: nombre,
    });
    res.status(201).json({
      ok: true,
      mensaje: 'Solicitud recibida, te contactaremos pronto',
      correo_enviado: enviado,
    });
  } catch (e) { next(e); }
});

router.get('/', requireAuth, requireRol('superadmin'), async (req, res, next) => {
  try {
    const estado = req.query.estado;
    if (estado !== undefined && !ESTADOS.includes(estado)) {
      return next(validacion('estado invalido'));
    }
    const { rows } = await db.query(
      `SELECT id, nombre, tipo, estado, contacto_nombre, contacto_correo, mensaje, creado_en, aprobado_en
       FROM organizaciones
       WHERE ($1::text IS NULL OR estado = $1)
       ORDER BY creado_en DESC
       LIMIT 200`,
      [estado ?? null]
    );
    res.json(rows);
  } catch (e) { next(e); }
});

router.get('/:id/usuarios', requireAuth, requireRol('superadmin'), async (req, res, next) => {
  try {
    if (!esId(req.params.id)) {
      return next(validacion('id invalido'));
    }
    const { rows } = await db.query(
      `SELECT id, nombre, correo, rol, activo, creado_en
       FROM usuarios WHERE organizacion_id = $1
       ORDER BY rol, nombre`,
      [req.params.id]
    );
    res.json(rows);
  } catch (e) { next(e); }
});

router.post('/:id/aprobar', requireAuth, requireRol('superadmin'), async (req, res, next) => {
  try {
    if (!esId(req.params.id)) {
      return next(validacion('id invalido'));
    }

    const body = await db.tx(async (c) => {
      const { rows } = await c.query(
        `SELECT id, nombre, tipo, estado, contacto_nombre, contacto_correo
         FROM organizaciones WHERE id = $1 FOR UPDATE`,
        [req.params.id]
      );
      const o = rows[0];
      if (!o) throw noEncontrado('Organizacion no encontrada');
      if (o.estado !== 'pendiente' || o.tipo !== 'empresa') {
        throw conflicto('Solo se pueden aprobar solicitudes pendientes de empresas');
      }

      const clave = generarClave();
      const hash = await bcrypt.hash(clave, 10);
      await c.query(
        `UPDATE organizaciones SET estado = 'activa', aprobado_en = now() WHERE id = $1`,
        [o.id]
      );
      const admin = await c.query(
        `INSERT INTO usuarios (nombre, correo, clave_hash, rol, organizacion_id)
         VALUES ($1, $2, $3, 'admin', $4)
         RETURNING id, nombre, correo`,
        [o.contacto_nombre, o.contacto_correo, hash, o.id]
      );
      const token = await emitir(c, admin.rows[0].id);
      return {
        organizacion: { id: o.id, nombre: o.nombre, estado: 'activa' },
        admin: admin.rows[0],
        token,
      };
    });
    const link = linkActivacion(body.token);
    const enviado = await enviarAccesoListo({
      nombre: body.admin.nombre,
      correo: body.admin.correo,
      link,
    });
    if (!enviado) {
      if (!process.env.BREVO_API_KEY) {
        console.warn('Invitacion (sin Brevo). Link:', link);
      } else {
        console.warn('No se pudo enviar el correo de invitacion a', body.admin.correo);
      }
    }
    res.status(201).json({
      organizacion: body.organizacion,
      admin: body.admin,
      correo_enviado: enviado,
    });
  } catch (e) { next(e); }
});

router.patch('/:id/estado', requireAuth, requireRol('superadmin'), async (req, res, next) => {
  try {
    if (!esId(req.params.id)) {
      return next(validacion('id invalido'));
    }
    const estado = req.body?.estado;
    if (typeof estado !== 'string' || !Object.hasOwn(TRANSICIONES, estado)) {
      return next(validacion('estado debe ser rechazada, suspendida o activa'));
    }

    const { rows } = await db.query(
      `UPDATE organizaciones SET estado = $1
       WHERE id = $2 AND estado = ANY($3)
       RETURNING id, nombre, tipo, estado`,
      [estado, req.params.id, TRANSICIONES[estado]]
    );
    if (rows.length === 0) {
      return next(conflicto('Organizacion no encontrada o transicion de estado no permitida'));
    }
    res.json(rows[0]);
  } catch (e) { next(e); }
});

router.post('/:id/reenviar-invitacion', requireAuth, requireRol('superadmin'), async (req, res, next) => {
  try {
    if (!esId(req.params.id)) {
      return next(validacion('id invalido'));
    }
    const { rows } = await db.query(
      `SELECT u.id, u.nombre, u.correo, o.estado, o.tipo
       FROM usuarios u
       JOIN organizaciones o ON o.id = u.organizacion_id
       WHERE o.id = $1 AND u.rol = 'admin'
       ORDER BY u.id ASC
       LIMIT 1`,
      [req.params.id]
    );
    const u = rows[0];
    if (!u) {
      return next(noEncontrado('Organizacion o admin no encontrado'));
    }
    if (u.estado !== 'activa' || u.tipo !== 'empresa') {
      return next(conflicto('Solo se reenvia la invitacion de una empresa activa'));
    }
    const previa = await db.query(
      `SELECT usada_en FROM invitaciones WHERE usuario_id = $1`,
      [u.id]
    );
    if (previa.rows[0]?.usada_en) {
      return next(conflicto('El admin ya creo su clave'));
    }

    const token = await db.tx((c) => emitir(c, u.id));
    const link = linkActivacion(token);
    const enviado = await enviarAccesoListo({
      nombre: u.nombre,
      correo: u.correo,
      link,
    });
    if (!enviado && !process.env.BREVO_API_KEY) {
      console.warn('Invitacion (sin Brevo). Link:', link);
    }
    res.json({
      ok: true,
      correo_enviado: enviado,
      admin: { id: u.id, nombre: u.nombre, correo: u.correo },
    });
  } catch (e) { next(e); }
});

module.exports = router;
