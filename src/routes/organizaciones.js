const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, requireRol } = require('../middleware/auth');
const { limitador } = require('../middleware/limitadores');
const { esId, normalizarCorreo, correoValido, texto, generarClave } = require('../utils');
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
      return res.status(400).json({ error: 'nombre, contacto_nombre y contacto_correo validos son obligatorios' });
    }

    await db.query(
      `INSERT INTO organizaciones (nombre, tipo, estado, contacto_nombre, contacto_correo, mensaje)
       VALUES ($1, 'empresa', 'pendiente', $2, $3, $4)`,
      [nombre, contactoNombre, contactoCorreo, texto(b.mensaje, 1000)]
    );
    res.status(201).json({ ok: true, mensaje: 'Solicitud recibida, te contactaremos pronto' });
  } catch (e) { next(e); }
});

router.get('/', requireAuth, requireRol('superadmin'), async (req, res, next) => {
  try {
    const estado = req.query.estado;
    if (estado !== undefined && !ESTADOS.includes(estado)) {
      return res.status(400).json({ error: 'estado invalido' });
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
      return res.status(400).json({ error: 'id invalido' });
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
      return res.status(400).json({ error: 'id invalido' });
    }

    const resultado = await db.tx(async (c) => {
      const { rows } = await c.query(
        `SELECT id, nombre, tipo, estado, contacto_nombre, contacto_correo
         FROM organizaciones WHERE id = $1 FOR UPDATE`,
        [req.params.id]
      );
      const o = rows[0];
      if (!o) {
        return { status: 404, error: 'Organizacion no encontrada' };
      }
      if (o.estado !== 'pendiente' || o.tipo !== 'empresa') {
        return { status: 409, error: 'Solo se pueden aprobar solicitudes pendientes de empresas' };
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
      return {
        status: 201,
        body: {
          organizacion: { id: o.id, nombre: o.nombre, estado: 'activa' },
          admin: { ...admin.rows[0], clave_temporal: clave },
        },
      };
    });

    if (resultado.error) {
      return res.status(resultado.status).json({ error: resultado.error });
    }
    res.status(201).json(resultado.body);
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ error: 'Ya existe un usuario con el correo de contacto' });
    }
    next(e);
  }
});

router.patch('/:id/estado', requireAuth, requireRol('superadmin'), async (req, res, next) => {
  try {
    if (!esId(req.params.id)) {
      return res.status(400).json({ error: 'id invalido' });
    }
    const estado = req.body?.estado;
    if (typeof estado !== 'string' || !Object.hasOwn(TRANSICIONES, estado)) {
      return res.status(400).json({ error: 'estado debe ser rechazada, suspendida o activa' });
    }

    const { rows } = await db.query(
      `UPDATE organizaciones SET estado = $1
       WHERE id = $2 AND estado = ANY($3)
       RETURNING id, nombre, tipo, estado`,
      [estado, req.params.id, TRANSICIONES[estado]]
    );
    if (rows.length === 0) {
      return res.status(409).json({ error: 'Organizacion no encontrada o transicion de estado no permitida' });
    }
    res.json(rows[0]);
  } catch (e) { next(e); }
});

module.exports = router;
