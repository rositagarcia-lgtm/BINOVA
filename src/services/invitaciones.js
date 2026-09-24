const { generarCodigo, sha256 } = require('../utils');

const HORAS = 72;

async function emitir(client, usuarioId) {
  const token = generarCodigo();
  await client.query(
    `INSERT INTO invitaciones (usuario_id, token_hash, expira_en)
     VALUES ($1, $2, now() + make_interval(hours => $3::int))
     ON CONFLICT (usuario_id) DO UPDATE
       SET token_hash = EXCLUDED.token_hash,
           expira_en = EXCLUDED.expira_en,
           usada_en = NULL,
           creado_en = now()`,
    [usuarioId, sha256(token), HORAS]
  );
  return token;
}

async function buscarPorToken(db, token, { bloquear } = {}) {
  const { rows } = await db.query(
    `SELECT i.id, i.expira_en, i.usada_en, u.id AS usuario_id, u.nombre, u.correo, u.activo,
            o.nombre AS org_nombre, o.estado AS org_estado
     FROM invitaciones i
     JOIN usuarios u ON u.id = i.usuario_id
     JOIN organizaciones o ON o.id = u.organizacion_id
     WHERE i.token_hash = $1
     ${bloquear ? 'FOR UPDATE OF i' : ''}`,
    [sha256(token)]
  );
  return rows[0] || null;
}

async function consumir(client, invitacionId) {
  await client.query(
    `UPDATE invitaciones SET usada_en = now() WHERE id = $1 AND usada_en IS NULL`,
    [invitacionId]
  );
}

module.exports = { emitir, buscarPorToken, consumir, HORAS };
