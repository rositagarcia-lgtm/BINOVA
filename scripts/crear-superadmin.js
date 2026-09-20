require('dotenv').config({ quiet: true });
const bcrypt = require('bcryptjs');
const { pool } = require('../src/db');
const { normalizarCorreo, correoValido, texto, generarClave } = require('../src/utils');

async function main() {
  const correo = normalizarCorreo(process.argv[2]);
  const nombre = texto(process.argv[3], 120);
  if (!correoValido(correo) || !nombre) {
    console.error('Uso: node scripts/crear-superadmin.js <correo> "<Nombre completo>"');
    process.exit(1);
  }

  const existe = await pool.query('SELECT 1 FROM usuarios WHERE lower(correo) = $1', [correo]);
  if (existe.rows.length > 0) {
    console.error('Ya existe un usuario con ese correo. Usa otro correo para el superadmin.');
    process.exit(1);
  }

  const clave = generarClave();
  await pool.query(
    `INSERT INTO usuarios (nombre, correo, clave_hash, rol, organizacion_id)
     VALUES ($1, $2, $3, 'superadmin', NULL)`,
    [nombre, correo, await bcrypt.hash(clave, 10)]
  );

  console.log('Superadmin creado.');
  console.log(`Correo: ${correo}`);
  console.log(`Clave temporal: ${clave}`);
  console.log('Inicia sesion y cambia la clave con POST /api/v1/auth/cambiar-clave');
}

main()
  .catch((e) => {
    console.error('Error:', e.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
