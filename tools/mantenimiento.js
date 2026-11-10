// Tareas periodicas de mantenimiento. Pensado para un "Cron Job" de Render cada 15 minutos.
//  - Genera las alertas "sin_reporte" de todas las organizaciones activas (sin depender de que alguien abra el panel).
//  - Borra lecturas antiguas (RETENCION_LECTURAS_DIAS, por defecto 180) para no llenar la base.
//  - Limpia invitaciones y enlaces de recuperacion ya vencidos o usados.
//  - Hace una consulta a la base, lo que evita que Supabase la pause por inactividad.
// Uso: npm run mantenimiento
require('dotenv').config({ quiet: true });
const db = require('../src/db');
const { generarSinReporte } = require('../src/services/alertas');

const RETENCION_DIAS = Number(process.env.RETENCION_LECTURAS_DIAS) || 180;
const LOTE = 5000;

async function purgarLecturas() {
  let total = 0;
  for (;;) {
    const r = await db.query(
      `DELETE FROM lecturas
       WHERE id IN (SELECT id FROM lecturas WHERE medido_en < now() - make_interval(days => $1::int) LIMIT $2)`,
      [RETENCION_DIAS, LOTE]
    );
    total += r.rowCount;
    if (r.rowCount < LOTE) return total;
  }
}

async function main() {
  const resumen = {};
  const orgs = await db.query(`SELECT id FROM organizaciones WHERE estado = 'activa'`);
  const antes = await db.query(`SELECT count(*)::int AS n FROM alertas WHERE tipo = 'sin_reporte' AND atendida_en IS NULL`);
  for (const o of orgs.rows) await generarSinReporte(o.id);
  const despues = await db.query(`SELECT count(*)::int AS n FROM alertas WHERE tipo = 'sin_reporte' AND atendida_en IS NULL`);
  resumen.organizaciones_revisadas = orgs.rowCount;
  resumen.alertas_sin_reporte_nuevas = despues.rows[0].n - antes.rows[0].n;

  resumen.lecturas_borradas = await purgarLecturas();
  resumen.retencion_dias = RETENCION_DIAS;

  const inv = await db.query(
    `DELETE FROM invitaciones WHERE (usada_en IS NOT NULL OR expira_en < now()) AND creado_en < now() - interval '30 days'`
  );
  const rec = await db.query(
    `DELETE FROM recuperaciones_clave WHERE (usada_en IS NOT NULL OR expira_en < now()) AND creado_en < now() - interval '7 days'`
  );
  resumen.invitaciones_borradas = inv.rowCount;
  resumen.recuperaciones_borradas = rec.rowCount;

  console.log(JSON.stringify({ t: new Date().toISOString(), mantenimiento: resumen }));
}

main()
  .catch((e) => { console.error('Mantenimiento fallo:', e.message); process.exitCode = 1; })
  .finally(() => db.pool.end());
