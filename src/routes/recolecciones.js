const express = require('express');
const db = require('../db');
const { requireAuth, requireRol } = require('../middleware/auth');
const { esId, texto, num, coordenadasValidas, fechaValida } = require('../utils');
const { haversine } = require('../services/rutas');
const router = express.Router();

router.post('/', requireAuth, requireRol('operario'), async (req, res, next) => {
  try {
    const b = req.body ?? {};
    const org = req.usuario.organizacion_id;

    const porId = b.contenedor_id !== undefined && b.contenedor_id !== null;
    const porCodigo = b.contenedor_codigo !== undefined && b.contenedor_codigo !== null;
    if (!porId && !porCodigo) {
      return res.status(400).json({ error: 'Indica contenedor_id o contenedor_codigo' });
    }
    if (porId && !esId(b.contenedor_id)) {
      return res.status(400).json({ error: 'contenedor_id invalido' });
    }

    let lat = null;
    let lng = null;
    if (b.lat !== undefined || b.lng !== undefined) {
      lat = num(b.lat);
      lng = num(b.lng);
      if (!coordenadasValidas(lat, lng)) {
        return res.status(400).json({ error: 'lat/lng invalidos' });
      }
    }

    const contenedor = await db.query(
      porId
        ? `SELECT id, nivel_actual, lat, lng FROM contenedores WHERE id = $1 AND organizacion_id = $2 AND activo = true`
        : `SELECT id, nivel_actual, lat, lng FROM contenedores WHERE codigo = $1 AND organizacion_id = $2 AND activo = true`,
      [porId ? b.contenedor_id : texto(b.contenedor_codigo, 40), org]
    );
    if (contenedor.rows.length === 0) {
      return res.status(404).json({ error: 'Contenedor no encontrado' });
    }
    const c = contenedor.rows[0];

    const turno = await db.query(
      `SELECT id FROM turnos WHERE usuario_id = $1 AND fin IS NULL`,
      [req.usuario.id]
    );
    if (turno.rows.length === 0) {
      return res.status(409).json({ error: 'Debes abrir un turno antes de registrar un vaciado' });
    }

    const reciente = await db.query(
      `SELECT 1 FROM recolecciones
       WHERE contenedor_id = $1 AND registrado_en > now() - interval '2 minutes'`,
      [c.id]
    );
    if (reciente.rows.length > 0) {
      return res.status(409).json({ error: 'Este contenedor ya fue vaciado hace instantes' });
    }

    const resultado = await db.tx(async (cx) => {
      const rec = await cx.query(
        `INSERT INTO recolecciones (contenedor_id, turno_id, nivel_antes, lat, lng, registrado_en)
         VALUES ($1, $2, $3, $4, $5, now())
         RETURNING id, registrado_en`,
        [c.id, turno.rows[0].id, c.nivel_actual, lat, lng]
      );
      await cx.query(
        `UPDATE contenedores SET nivel_actual = 0, estado = 'verde' WHERE id = $1`,
        [c.id]
      );
      const alertas = await cx.query(
        `UPDATE alertas SET atendida_en = now(), recoleccion_id = $1
         WHERE contenedor_id = $2 AND tipo = 'llenado_critico' AND atendida_en IS NULL`,
        [rec.rows[0].id, c.id]
      );
      return { recoleccion: rec.rows[0], atendidas: alertas.rowCount };
    });

    const tieneUbicacion = lat !== null && c.lat !== null && c.lng !== null;
    res.status(201).json({
      id: resultado.recoleccion.id,
      contenedor_id: c.id,
      nivel_antes: c.nivel_actual,
      registrado_en: resultado.recoleccion.registrado_en,
      distancia_m: tieneUbicacion
        ? Math.round(haversine({ lat, lng }, { lat: Number(c.lat), lng: Number(c.lng) }))
        : null,
      alertas_atendidas: resultado.atendidas,
    });
  } catch (e) { next(e); }
});

router.get('/', requireAuth, requireRol('admin', 'supervisor', 'operario'), async (req, res, next) => {
  try {
    const { contenedor_id: contenedorId, desde, hasta } = req.query;
    if (contenedorId !== undefined && !esId(contenedorId)) {
      return res.status(400).json({ error: 'contenedor_id invalido' });
    }
    if ((desde !== undefined && !fechaValida(desde)) || (hasta !== undefined && !fechaValida(hasta))) {
      return res.status(400).json({ error: 'desde y hasta deben tener formato AAAA-MM-DD' });
    }

    const verTodas = ['admin', 'supervisor'].includes(req.usuario.rol);
    const { rows } = await db.query(
      `SELECT r.id, r.registrado_en, r.nivel_antes, r.lat, r.lng,
              c.id AS contenedor_id, c.codigo AS contenedor_codigo, c.nombre AS contenedor_nombre,
              u.nombre AS operario, ca.codigo AS carrito_codigo
       FROM recolecciones r
       JOIN contenedores c ON c.id = r.contenedor_id
       JOIN turnos t ON t.id = r.turno_id
       JOIN usuarios u ON u.id = t.usuario_id
       JOIN carritos ca ON ca.id = t.carrito_id
       WHERE c.organizacion_id = $1
         AND ($2::boolean OR t.usuario_id = $3)
         AND ($4::bigint IS NULL OR r.contenedor_id = $4)
         AND ($5::date IS NULL OR (r.registrado_en AT TIME ZONE 'America/Lima')::date >= $5::date)
         AND ($6::date IS NULL OR (r.registrado_en AT TIME ZONE 'America/Lima')::date <= $6::date)
       ORDER BY r.registrado_en DESC
       LIMIT 200`,
      [req.usuario.organizacion_id, verTodas, req.usuario.id, contenedorId ?? null, desde ?? null, hasta ?? null]
    );
    res.json(rows);
  } catch (e) { next(e); }
});

module.exports = router;
