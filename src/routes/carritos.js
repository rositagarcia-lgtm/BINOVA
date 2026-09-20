const express = require('express');
const db = require('../db');
const { requireAuth, requireRol } = require('../middleware/auth');
const { esId, texto, num } = require('../utils');
const router = express.Router();

async function validarZona(zonaId, org) {
  if (zonaId === undefined || zonaId === null) return { valor: null };
  if (!esId(zonaId)) return { estado: 400, mensaje: 'zona_id invalido' };
  const zona = await db.query(`SELECT id FROM zonas WHERE id = $1 AND organizacion_id = $2`, [zonaId, org]);
  if (zona.rows.length === 0) return { estado: 404, mensaje: 'Zona no encontrada' };
  return { valor: zona.rows[0].id };
}

router.get('/', requireAuth, requireRol('admin', 'supervisor', 'operario'), async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT ca.id, ca.codigo, ca.placa, ca.descripcion, ca.capacidad_l,
             ca.zona_id, z.nombre AS zona,
             ca.ult_lat, ca.ult_lng, ca.ult_posicion_en
      FROM carritos ca
      LEFT JOIN zonas z ON z.id = ca.zona_id
      WHERE ca.activo = true AND ca.organizacion_id = $1
      ORDER BY ca.codigo
    `, [req.usuario.organizacion_id]);
    res.json(rows);
  } catch (e) { next(e); }
});

router.post('/', requireAuth, requireRol('admin', 'supervisor'), async (req, res, next) => {
  try {
    const b = req.body ?? {};
    const codigo = texto(b.codigo, 40);
    if (!codigo) {
      return res.status(400).json({ error: 'Falta codigo' });
    }

    let capacidad = null;
    if (b.capacidad_l !== undefined && b.capacidad_l !== null) {
      capacidad = num(b.capacidad_l);
      if (!Number.isInteger(capacidad) || capacidad <= 0) {
        return res.status(400).json({ error: 'capacidad_l debe ser un entero mayor que 0' });
      }
    }
    const zona = await validarZona(b.zona_id, req.usuario.organizacion_id);
    if (zona.estado) {
      return res.status(zona.estado).json({ error: zona.mensaje });
    }

    const { rows } = await db.query(
      `INSERT INTO carritos (codigo, placa, descripcion, capacidad_l, zona_id, activo, organizacion_id)
       VALUES ($1, $2, $3, $4, $5, true, $6)
       RETURNING id, codigo, placa, descripcion, capacidad_l, zona_id`,
      [codigo, texto(b.placa, 20), texto(b.descripcion, 200), capacidad, zona.valor, req.usuario.organizacion_id]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ error: 'Ya existe un carrito con ese codigo o placa' });
    }
    next(e);
  }
});

router.patch('/:id', requireAuth, requireRol('admin', 'supervisor'), async (req, res, next) => {
  try {
    if (!esId(req.params.id)) {
      return res.status(400).json({ error: 'id invalido' });
    }
    const b = req.body ?? {};
    const org = req.usuario.organizacion_id;

    const columnas = [];
    const valores = [];
    const poner = (columna, valor) => {
      valores.push(valor);
      columnas.push(`${columna} = $${valores.length}`);
    };

    if (b.descripcion !== undefined) poner('descripcion', texto(b.descripcion, 200));
    if (b.placa !== undefined) poner('placa', texto(b.placa, 20));
    if (b.capacidad_l !== undefined) {
      const capacidad = b.capacidad_l === null ? null : num(b.capacidad_l);
      if (capacidad !== null && (!Number.isInteger(capacidad) || capacidad <= 0)) {
        return res.status(400).json({ error: 'capacidad_l debe ser un entero mayor que 0' });
      }
      poner('capacidad_l', capacidad);
    }
    if (b.zona_id !== undefined) {
      const zona = await validarZona(b.zona_id, org);
      if (zona.estado) {
        return res.status(zona.estado).json({ error: zona.mensaje });
      }
      poner('zona_id', zona.valor);
    }
    if (b.activo !== undefined) {
      if (typeof b.activo !== 'boolean') {
        return res.status(400).json({ error: 'activo debe ser true o false' });
      }
      if (b.activo === false) {
        const enUso = await db.query(
          `SELECT 1 FROM turnos t JOIN carritos c ON c.id = t.carrito_id
           WHERE t.carrito_id = $1 AND c.organizacion_id = $2 AND t.fin IS NULL`,
          [req.params.id, org]
        );
        if (enUso.rows.length > 0) {
          return res.status(409).json({ error: 'El carrito tiene un turno abierto' });
        }
      }
      poner('activo', b.activo);
    }
    if (columnas.length === 0) {
      return res.status(400).json({ error: 'No hay nada que actualizar' });
    }

    valores.push(req.params.id, org);
    const { rows } = await db.query(
      `UPDATE carritos SET ${columnas.join(', ')}
       WHERE id = $${valores.length - 1} AND organizacion_id = $${valores.length}
       RETURNING id, codigo, placa, descripcion, capacidad_l, zona_id, activo`,
      valores
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Carrito no encontrado' });
    }
    res.json(rows[0]);
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ error: 'Ya existe un carrito con esa placa' });
    }
    next(e);
  }
});

module.exports = router;
