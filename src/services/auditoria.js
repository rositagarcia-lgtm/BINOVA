const db = require('../db');

// Registra una accion sensible. Nunca lanza: una falla de auditoria no debe romper la operacion.
async function auditar({ usuario, organizacionId, accion, entidad = null, entidadId = null, detalle = null }) {
  try {
    await db.query(
      `INSERT INTO auditoria (usuario_id, organizacion_id, accion, entidad, entidad_id, detalle)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        usuario?.id ?? null,
        organizacionId ?? usuario?.organizacion_id ?? null,
        accion,
        entidad,
        entidadId,
        detalle ? JSON.stringify(detalle) : null,
      ]
    );
  } catch (e) {
    console.error('No se pudo registrar la auditoria:', accion, e.message);
  }
}

module.exports = { auditar };
