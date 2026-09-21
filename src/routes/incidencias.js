const express = require('express');
const db = require('../db');
const { requireAuth, requireRol } = require('../middleware/auth');
const { esId, texto } = require('../utils');
const router = express.Router();

const ROLES_ORG = ['admin', 'supervisor', 'operario'];
const TIPOS = ['tapa_danada', 'sensor_sucio', 'acceso_bloqueado', 'otro'];

router.post('/', requireAuth, requireRol(...ROLES_ORG), async (req, res, next) => {
  try {
    const b = req.body ?? {};
    const org = req.usuario.organizacion_id;

    const tipo = typeof b.tipo === 'string' ? b.tipo.trim().toLowerCase().replace('ñ', 'n') : '';
    if (!TIPOS.includes(tipo)) {
      return res.status(400).json({ error: 'tipo debe ser tapa_danada, sensor_sucio, acceso_bloqueado u otro' });
    }

    const descripcion = texto(b.descripcion, 1000);
    let fotoUrl = null;
    if (b.foto_url !== undefined && b.foto_url !== null) {
      fotoUrl = texto(b.foto_url, 500);
      if (!fotoUrl || !/^https?:\/\//i.test(fotoUrl)) {
        return res.status(400).json({ error: 'foto_url debe ser un enlace http o https' });
      }
    }

    let contenedorId = null;
    const porId = b.contenedor_id !== undefined && b.contenedor_id !== null;
    const porCodigo = b.contenedor_codigo !== undefined && b.contenedor_codigo !== null;
    if (porId || porCodigo) {
      if (porId && !esId(b.contenedor_id)) {
        return res.status(400).json({ error: 'contenedor_id invalido' });
      }
      const contenedor = await db.query(
        porId
          ? `SELECT id FROM contenedores WHERE id = $1 AND organizacion_id = $2 AND activo = true`
          : `SELECT id FROM contenedores WHERE codigo = $1 AND organizacion_id = $2 AND activo = true`,
        [porId ? b.contenedor_id : texto(b.contenedor_codigo, 40), org]
      );
      if (contenedor.rows.length === 0) {
        return res.status(404).json({ error: 'Contenedor no encontrado' });
      }
      contenedorId = contenedor.rows[0].id;
    } else if (!descripcion) {
      return res.status(400).json({ error: 'Indica el contenedor o describe la incidencia' });
    }

    const turno = await db.query(
      `SELECT id FROM turnos WHERE usuario_id = $1 AND fin IS NULL`,
      [req.usuario.id]
    );

    const { rows } = await db.query(
      `INSERT INTO incidencias
         (organizacion_id, usuario_id, contenedor_id, turno_id, tipo, descripcion, foto_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, tipo, descripcion, foto_url, contenedor_id, reportada_en`,
      [org, req.usuario.id, contenedorId, turno.rows[0]?.id ?? null, tipo, descripcion, fotoUrl]
    );
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

router.get('/', requireAuth, requireRol(...ROLES_ORG), async (req, res, next) => {
  try {
    const estado = req.query.estado;
    if (estado !== undefined && estado !== 'pendiente' && estado !== 'resuelta') {
      return res.status(400).json({ error: 'estado debe ser pendiente o resuelta' });
    }

    const verTodas = ['admin', 'supervisor'].includes(req.usuario.rol);
    const { rows } = await db.query(
      `SELECT i.id, i.tipo, i.descripcion, i.foto_url, i.reportada_en, i.resuelta_en,
              c.id AS contenedor_id, c.codigo AS contenedor_codigo, c.nombre AS contenedor_nombre,
              u.nombre AS reportada_por
       FROM incidencias i
       LEFT JOIN contenedores c ON c.id = i.contenedor_id
       LEFT JOIN usuarios u ON u.id = i.usuario_id
       WHERE i.organizacion_id = $1
         AND ($2::boolean OR i.usuario_id = $3)
         AND ($4::text IS NULL
              OR ($4 = 'pendiente' AND i.resuelta_en IS NULL)
              OR ($4 = 'resuelta' AND i.resuelta_en IS NOT NULL))
       ORDER BY i.reportada_en DESC
       LIMIT 200`,
      [req.usuario.organizacion_id, verTodas, req.usuario.id, estado ?? null]
    );
    res.json(rows);
  } catch (e) { next(e); }
});

router.patch('/:id/resolver', requireAuth, requireRol('admin', 'supervisor'), async (req, res, next) => {
  try {
    if (!esId(req.params.id)) {
      return res.status(400).json({ error: 'id invalido' });
    }
    const { rows } = await db.query(
      `UPDATE incidencias SET resuelta_en = now(), resuelta_por = $1
       WHERE id = $2 AND organizacion_id = $3 AND resuelta_en IS NULL
       RETURNING id, tipo, reportada_en, resuelta_en`,
      [req.usuario.id, req.params.id, req.usuario.organizacion_id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Incidencia no encontrada o ya resuelta' });
    }
    res.json(rows[0]);
  } catch (e) { next(e); }
});

module.exports = router;
