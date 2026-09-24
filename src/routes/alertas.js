const express = require('express');
const { conflicto, noEncontrado, prohibido, validacion } = require('../errors');
const db = require('../db');
const { requireAuth, requireRol } = require('../middleware/auth');
const { esId } = require('../utils');
const { generarSinReporte } = require('../services/alertas');
const router = express.Router();

const TIPOS = ['llenado_critico', 'bateria_baja', 'sin_reporte'];

async function carritoDelTurno(usuarioId) {
  const { rows } = await db.query(
    `SELECT c.id, c.codigo, c.zona_id
     FROM turnos t JOIN carritos c ON c.id = t.carrito_id
     WHERE t.usuario_id = $1 AND t.fin IS NULL`,
    [usuarioId]
  );
  return rows[0] || null;
}

router.get('/', requireAuth, requireRol('admin', 'supervisor', 'operario'), async (req, res, next) => {
  try {
    const { estado, tipo } = req.query;
    if (estado !== undefined && estado !== 'pendiente' && estado !== 'atendida') {
      return next(validacion('estado debe ser pendiente o atendida'));
    }
    if (tipo !== undefined && !TIPOS.includes(tipo)) {
      return next(validacion('tipo debe ser llenado_critico, bateria_baja o sin_reporte'));
    }

    const esOperario = req.usuario.rol === 'operario';
    let carrito = null;
    if (esOperario) {
      carrito = await carritoDelTurno(req.usuario.id);
      if (!carrito) {
        return res.json([]);
      }
    }

    await generarSinReporte(req.usuario.organizacion_id);

    const { rows } = await db.query(
      `SELECT a.id, a.tipo, a.nivel, a.generada_en, a.atendida_en, a.recoleccion_id,
              a.carrito_id, ca.codigo AS carrito_codigo, a.tomada_en,
              c.id AS contenedor_id, c.codigo AS contenedor_codigo, c.nombre AS contenedor_nombre,
              c.zona_id, z.nombre AS zona,
              EXISTS (
                SELECT 1 FROM turnos t2 JOIN carritos ca2 ON ca2.id = t2.carrito_id
                WHERE t2.fin IS NULL AND ca2.organizacion_id = c.organizacion_id AND ca2.activo = true
                  AND (ca2.zona_id IS NULL OR ca2.zona_id = c.zona_id)
              ) AS hay_carrito_en_turno
       FROM alertas a
       JOIN contenedores c ON c.id = a.contenedor_id
       LEFT JOIN zonas z ON z.id = c.zona_id
       LEFT JOIN carritos ca ON ca.id = a.carrito_id
       WHERE c.organizacion_id = $1
         AND ($2::text IS NULL
              OR ($2 = 'pendiente' AND a.atendida_en IS NULL)
              OR ($2 = 'atendida' AND a.atendida_en IS NOT NULL))
         AND ($3::text IS NULL OR a.tipo = $3)
         AND (NOT $4::boolean
              OR a.carrito_id = $5::bigint
              OR (a.carrito_id IS NULL AND ($6::bigint IS NULL OR c.zona_id = $6::bigint)))
       ORDER BY a.generada_en DESC
       LIMIT 200`,
      [req.usuario.organizacion_id, estado ?? null, tipo ?? null, esOperario, carrito?.id ?? null, carrito?.zona_id ?? null]
    );
    res.json(rows);
  } catch (e) { next(e); }
});

router.patch('/:id/tomar', requireAuth, requireRol('operario'), async (req, res, next) => {
  try {
    if (!esId(req.params.id)) {
      return next(validacion('id invalido'));
    }
    const carrito = await carritoDelTurno(req.usuario.id);
    if (!carrito) {
      return next(conflicto('Debes abrir un turno para tomar una alerta'));
    }

    const { rows } = await db.query(
      `UPDATE alertas a
       SET carrito_id = $1, tomada_en = CASE WHEN a.carrito_id = $1 THEN a.tomada_en ELSE now() END
       FROM contenedores c
       WHERE a.id = $2 AND c.id = a.contenedor_id AND c.organizacion_id = $3
         AND a.atendida_en IS NULL
         AND (a.carrito_id = $1
              OR (a.carrito_id IS NULL AND ($4::bigint IS NULL OR c.zona_id = $4::bigint)))
       RETURNING a.id, a.tipo, a.carrito_id, a.tomada_en`,
      [carrito.id, req.params.id, req.usuario.organizacion_id, carrito.zona_id]
    );
    if (rows.length > 0) {
      return res.json({ ...rows[0], carrito_codigo: carrito.codigo });
    }

    const actual = await db.query(
      `SELECT a.carrito_id, a.atendida_en FROM alertas a
       JOIN contenedores c ON c.id = a.contenedor_id
       WHERE a.id = $1 AND c.organizacion_id = $2`,
      [req.params.id, req.usuario.organizacion_id]
    );
    const a = actual.rows[0];
    if (!a || a.atendida_en) {
      return next(noEncontrado('Alerta no encontrada o ya atendida'));
    }
    if (a.carrito_id !== null) {
      return next(conflicto('La alerta ya fue tomada por otro carrito'));
    }
    return next(prohibido('La alerta es de una zona que no atiende tu carrito'));
  } catch (e) { next(e); }
});

router.patch('/:id/soltar', requireAuth, requireRol('admin', 'supervisor', 'operario'), async (req, res, next) => {
  try {
    if (!esId(req.params.id)) {
      return next(validacion('id invalido'));
    }
    let carritoId = null;
    if (req.usuario.rol === 'operario') {
      const carrito = await carritoDelTurno(req.usuario.id);
      if (!carrito) {
        return next(conflicto('Debes tener un turno abierto'));
      }
      carritoId = carrito.id;
    }

    const { rows } = await db.query(
      `UPDATE alertas a SET carrito_id = NULL, tomada_en = NULL
       FROM contenedores c
       WHERE a.id = $1 AND c.id = a.contenedor_id AND c.organizacion_id = $2
         AND a.atendida_en IS NULL AND a.carrito_id IS NOT NULL
         AND ($3::bigint IS NULL OR a.carrito_id = $3::bigint)
       RETURNING a.id, a.tipo`,
      [req.params.id, req.usuario.organizacion_id, carritoId]
    );
    if (rows.length === 0) {
      return next(noEncontrado('Alerta no encontrada, sin asignar o no es de tu carrito'));
    }
    res.json(rows[0]);
  } catch (e) { next(e); }
});

router.patch('/:id/asignar', requireAuth, requireRol('admin', 'supervisor'), async (req, res, next) => {
  try {
    if (!esId(req.params.id)) {
      return next(validacion('id invalido'));
    }
    const carritoId = req.body?.carrito_id;
    if (!esId(carritoId)) {
      return next(validacion('carrito_id invalido'));
    }
    const carrito = await db.query(
      `SELECT id, codigo FROM carritos WHERE id = $1 AND organizacion_id = $2 AND activo = true`,
      [carritoId, req.usuario.organizacion_id]
    );
    if (carrito.rows.length === 0) {
      return next(noEncontrado('Carrito no encontrado'));
    }

    const { rows } = await db.query(
      `UPDATE alertas a SET carrito_id = $1, tomada_en = now()
       FROM contenedores c
       WHERE a.id = $2 AND c.id = a.contenedor_id AND c.organizacion_id = $3 AND a.atendida_en IS NULL
       RETURNING a.id, a.tipo, a.carrito_id, a.tomada_en`,
      [carrito.rows[0].id, req.params.id, req.usuario.organizacion_id]
    );
    if (rows.length === 0) {
      return next(noEncontrado('Alerta no encontrada o ya atendida'));
    }
    res.json({ ...rows[0], carrito_codigo: carrito.rows[0].codigo });
  } catch (e) { next(e); }
});

router.patch('/:id/atender', requireAuth, requireRol('admin', 'supervisor'), async (req, res, next) => {
  try {
    if (!esId(req.params.id)) {
      return next(validacion('id invalido'));
    }
    const { rows } = await db.query(
      `UPDATE alertas a SET atendida_en = now()
       FROM contenedores c
       WHERE a.id = $1 AND c.id = a.contenedor_id AND c.organizacion_id = $2 AND a.atendida_en IS NULL
       RETURNING a.id, a.tipo, a.generada_en, a.atendida_en`,
      [req.params.id, req.usuario.organizacion_id]
    );
    if (rows.length === 0) {
      return next(noEncontrado('Alerta no encontrada o ya atendida'));
    }
    res.json(rows[0]);
  } catch (e) { next(e); }
});

module.exports = router;
