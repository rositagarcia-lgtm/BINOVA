require('dotenv').config({ quiet: true });
const bcrypt = require('bcryptjs');
const { pool } = require('../src/db');
const { normalizarCorreo, correoValido, generarClave } = require('../src/utils');

async function main() {
  const correo = normalizarCorreo(process.argv[2]);
  if (!correoValido(correo)) {
    console.error('Uso: node scripts/restablecer-clave.js <correo>');
    process.exit(1);
  }

  const { rows } = await pool.query(
    'SELECT id, rol, activo FROM usuarios WHERE lower(correo) = $1',
    [correo]
  );
  if (rows.length === 0) {
    console.error('No existe un usuario con ese correo.');
    process.exit(1);
  }
  if (!rows[0].activo) {
    console.error('El usuario esta desactivado; reactivalo antes de restablecer su clave.');
    process.exit(1);
  }

  const clave = generarClave();
  await pool.query('UPDATE usuarios SET clave_hash = $1 WHERE id = $2', [await bcrypt.hash(clave, 10), rows[0].id]);

  console.log(`Clave restablecida para ${correo} (rol: ${rows[0].rol}).`);
  console.log(`Clave temporal: ${clave}`);
  console.log('Inicia sesion y cambiala con POST /api/v1/auth/cambiar-clave');
}

main()
  .catch((e) => {
    console.error('Error:', e.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
