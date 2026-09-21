require('dotenv').config({ quiet: true });
const bcrypt = require('bcryptjs');
const { pool } = require('../src/db');
const { normalizarCorreo, correoValido, texto, esId, generarClave } = require('../src/utils');

const ROLES = ['admin', 'supervisor', 'operario'];

async function main() {
  const correo = normalizarCorreo(process.argv[2]);
  const nombre = texto(process.argv[3], 120);
  const rol = process.argv[4];
  const organizacionId = process.argv[5];
  if (!correoValido(correo) || !nombre || !ROLES.includes(rol) || !esId(organizacionId)) {
    console.error('Uso: node scripts/crear-usuario.js <correo> "<Nombre completo>" <admin|supervisor|operario> <id_organizacion>');
    process.exit(1);
  }

  const org = await pool.query('SELECT nombre, tipo, estado FROM organizaciones WHERE id = $1', [organizacionId]);
  if (org.rows.length === 0) {
    console.error('No existe una organizacion con ese id.');
    process.exit(1);
  }
  if (org.rows[0].tipo !== 'empresa' || org.rows[0].estado !== 'activa') {
    console.error('La organizacion debe ser una empresa activa.');
    process.exit(1);
  }
  const existe = await pool.query('SELECT 1 FROM usuarios WHERE lower(correo) = $1', [correo]);
  if (existe.rows.length > 0) {
    console.error('Ya existe un usuario con ese correo.');
    process.exit(1);
  }

  const clave = generarClave();
  await pool.query(
    `INSERT INTO usuarios (nombre, correo, clave_hash, rol, organizacion_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [nombre, correo, await bcrypt.hash(clave, 10), rol, organizacionId]
  );

  console.log(`Usuario creado en "${org.rows[0].nombre}" con rol ${rol}.`);
  console.log(`Correo: ${correo}`);
  console.log(`Clave temporal: ${clave}`);
  console.log('Debe iniciar sesion y cambiarla con POST /api/v1/auth/cambiar-clave');
}

main()
  .catch((e) => {
    console.error('Error:', e.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
