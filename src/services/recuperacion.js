const { generarCodigo, sha256 } = require('../utils');

const MINUTOS = 60;

async function emitir(client, usuarioId) {
  await client.query(
    `UPDATE recuperaciones_clave SET usada_en = now() WHERE usuario_id = $1 AND usada_en IS NULL`,
    [usuarioId]
  );
  const token = generarCodigo();
  await client.query(
    `INSERT INTO recuperaciones_clave (usuario_id, token_hash, expira_en)
     VALUES ($1, $2, now() + make_interval(mins => $3::int))`,
    [usuarioId, sha256(token), MINUTOS]
  );
  return token;
}

async function buscarPorToken(db, token, { bloquear } = {}) {
  const { rows } = await db.query(
    `SELECT r.id, r.expira_en, r.usada_en, u.id AS usuario_id, u.nombre, u.correo, u.activo, u.rol, u.organizacion_id,
            o.estado AS org_estado
     FROM recuperaciones_clave r
     JOIN usuarios u ON u.id = r.usuario_id
     LEFT JOIN organizaciones o ON o.id = u.organizacion_id
     WHERE r.token_hash = $1
     ${bloquear ? 'FOR UPDATE OF r' : ''}`,
    [sha256(token)]
  );
  return rows[0] || null;
}

async function consumir(client, id) {
  await client.query(`UPDATE recuperaciones_clave SET usada_en = now() WHERE id = $1 AND usada_en IS NULL`, [id]);
}

module.exports = { emitir, buscarPorToken, consumir, MINUTOS };
