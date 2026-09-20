const express = require('express');
const db = require('../db');
const { requireAuth, requireRol } = require('../middleware/auth');
const { entero } = require('../utils');
const { generarSinReporte } = require('../services/alertas');
const router = express.Router();

router.get('/resumen', requireAuth, requireRol('admin', 'supervisor'), async (req, res, next) => {
  try {
    const org = req.usuario.organizacion_id;
    await generarSinReporte(org);

    const [contenedores, alertas, incidencias, recolecciones, respuesta, turnos] = await Promise.all([
      db.query(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE estado = 'verde')::int AS verde,
                count(*) FILTER (WHERE estado = 'ambar')::int AS ambar,
                count(*) FILTER (WHERE estado = 'rojo')::int AS rojo,
                count(*) FILTER (WHERE estado IS NULL)::int AS sin_lectura
         FROM contenedores WHERE organizacion_id = $1 AND activo = true`,
        [org]
      ),
      db.query(
        `SELECT a.tipo, count(*)::int AS n
         FROM alertas a JOIN contenedores c ON c.id = a.contenedor_id
         WHERE c.organizacion_id = $1 AND a.atendida_en IS NULL
         GROUP BY a.tipo`,
        [org]
      ),
      db.query(
        `SELECT count(*)::int AS pendientes FROM incidencias
         WHERE organizacion_id = $1 AND resuelta_en IS NULL`,
        [org]
      ),
      db.query(
        `SELECT
           count(*) FILTER (WHERE (r.registrado_en AT TIME ZONE 'America/Lima')::date
                                  = (now() AT TIME ZONE 'America/Lima')::date)::int AS hoy,
           count(*) FILTER (WHERE r.registrado_en >= now() - interval '7 days')::int AS ultimos_7_dias,
           count(*) FILTER (WHERE r.registrado_en >= now() - interval '30 days')::int AS ultimos_30_dias,
           count(*) FILTER (WHERE r.registrado_en >= now() - interval '30 days'
                              AND r.nivel_antes IS NOT NULL
                              AND r.nivel_antes < c.umbral_ambar)::int AS innecesarios_30_dias
         FROM recolecciones r JOIN contenedores c ON c.id = r.contenedor_id
         WHERE c.organizacion_id = $1`,
        [org]
      ),
      db.query(
        `SELECT round(avg(extract(epoch FROM (a.atendida_en - a.generada_en)) / 60))::int AS minutos
         FROM alertas a JOIN contenedores c ON c.id = a.contenedor_id
         WHERE c.organizacion_id = $1 AND a.tipo = 'llenado_critico'
           AND a.recoleccion_id IS NOT NULL AND a.generada_en >= now() - interval '30 days'`,
        [org]
      ),
      db.query(
        `SELECT count(*)::int AS abiertos
         FROM turnos t JOIN usuarios u ON u.id = t.usuario_id
         WHERE u.organizacion_id = $1 AND t.fin IS NULL`,
        [org]
      ),
    ]);

    const pendientesPorTipo = { llenado_critico: 0, bateria_baja: 0, sin_reporte: 0 };
    alertas.rows.forEach((f) => { pendientesPorTipo[f.tipo] = f.n; });

    res.json({
      contenedores: contenedores.rows[0],
      alertas_pendientes: pendientesPorTipo,
      incidencias_pendientes: incidencias.rows[0].pendientes,
      recolecciones: recolecciones.rows[0],
      tiempo_medio_respuesta_min: respuesta.rows[0].minutos,
      turnos_abiertos: turnos.rows[0].abiertos,
    });
  } catch (e) { next(e); }
});

router.get('/recolecciones-por-dia', requireAuth, requireRol('admin', 'supervisor'), async (req, res, next) => {
  try {
    const dias = req.query.dias === undefined ? 14 : entero(req.query.dias, 1, 90);
    if (dias === null) {
      return res.status(400).json({ error: 'dias debe ser un entero entre 1 y 90' });
    }
    const { rows } = await db.query(
      `SELECT to_char((r.registrado_en AT TIME ZONE 'America/Lima')::date, 'YYYY-MM-DD') AS dia,
              count(*)::int AS vaciados
       FROM recolecciones r JOIN contenedores c ON c.id = r.contenedor_id
       WHERE c.organizacion_id = $1 AND r.registrado_en >= now() - make_interval(days => $2::int)
       GROUP BY 1 ORDER BY 1`,
      [req.usuario.organizacion_id, dias]
    );
    res.json(rows);
  } catch (e) { next(e); }
});

module.exports = router;
