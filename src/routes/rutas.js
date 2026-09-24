const express = require('express');
const { validacion } = require('../errors');
const db = require('../db');
const { requireAuth, requireRol } = require('../middleware/auth');
const { esId, num, entero, coordenadasValidas } = require('../utils');
const { planificarRuta } = require('../services/rutas');
const router = express.Router();

const ESTADOS = ['rojo', 'ambar', 'verde'];
const PERFILES = ['walking', 'driving', 'cycling'];

router.get('/optima', requireAuth, requireRol('admin', 'supervisor', 'operario'), async (req, res, next) => {
  try {
    const q = req.query;

    const estados = q.estados === undefined
      ? ['rojo', 'ambar']
      : String(q.estados).split(',').map((s) => s.trim());
    if (estados.length === 0 || !estados.every((e) => ESTADOS.includes(e))) {
      return next(validacion('estados debe ser una lista de rojo, ambar y verde'));
    }
    const nivelMin = q.nivel_min === undefined ? 0 : entero(q.nivel_min, 0, 100);
    if (nivelMin === null) {
      return next(validacion('nivel_min debe ser un entero entre 0 y 100'));
    }
    const max = q.max === undefined ? 20 : entero(q.max, 1, 24);
    if (max === null) {
      return next(validacion('max debe ser un entero entre 1 y 24'));
    }
    const perfil = q.perfil === undefined ? 'walking' : q.perfil;
    if (!PERFILES.includes(perfil)) {
      return next(validacion('perfil debe ser walking, driving o cycling'));
    }
    if (q.zona_id !== undefined && !esId(q.zona_id)) {
      return next(validacion('zona_id invalido'));
    }

    let origen = null;
    if (q.lat !== undefined || q.lng !== undefined) {
      const lat = num(q.lat);
      const lng = num(q.lng);
      if (!coordenadasValidas(lat, lng)) {
        return next(validacion('lat y lng deben enviarse juntos y ser validos'));
      }
      origen = { lat, lng, tipo: 'parametro' };
    }

    const turno = await db.query(
      `SELECT c.zona_id, c.ult_lat, c.ult_lng
       FROM turnos t JOIN carritos c ON c.id = t.carrito_id
       WHERE t.usuario_id = $1 AND t.fin IS NULL`,
      [req.usuario.id]
    );
    const carrito = turno.rows[0] || null;
    if (!origen && carrito && carrito.ult_lat !== null && carrito.ult_lng !== null) {
      origen = { lat: Number(carrito.ult_lat), lng: Number(carrito.ult_lng), tipo: 'carrito' };
    }
    const zonaId = q.zona_id ?? (req.usuario.rol === 'operario' && carrito ? carrito.zona_id : null);

    const { rows } = await db.query(
      `SELECT id, codigo, nombre, lat, lng, nivel_actual, estado, count(*) OVER() AS candidatos
       FROM contenedores
       WHERE organizacion_id = $1 AND activo = true
         AND lat IS NOT NULL AND lng IS NOT NULL
         AND estado = ANY($2)
         AND COALESCE(nivel_actual, 0) >= $3
         AND ($4::bigint IS NULL OR zona_id = $4)
       ORDER BY nivel_actual DESC NULLS LAST
       LIMIT $5`,
      [req.usuario.organizacion_id, estados, nivelMin, zonaId, max]
    );

    const candidatos = rows.length > 0 ? Number(rows[0].candidatos) : 0;
    const contenedores = rows.map((c) => {
      const lat = Number(c.lat);
      const lng = Number(c.lng);
      return {
        lat,
        lng,
        contenedor: { id: c.id, codigo: c.codigo, nombre: c.nombre, lat, lng, nivel_actual: c.nivel_actual, estado: c.estado },
      };
    });

    const ruta = await planificarRuta({ origen, contenedores, perfil });
    res.json({
      perfil,
      zona_id: zonaId,
      origen: origen
        ? { lat: origen.lat, lng: origen.lng, tipo: origen.tipo }
        : { tipo: 'contenedor_mas_lleno' },
      candidatos,
      omitidos: Math.max(0, candidatos - contenedores.length),
      ...ruta,
    });
  } catch (e) { next(e); }
});

module.exports = router;
