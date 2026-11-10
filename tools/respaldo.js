// Respaldo de todas las tablas a un archivo JSON (el plan gratis de Supabase no hace copias automaticas).
// El archivo contiene hashes de claves y datos de usuarios: NO lo subas a Git ni lo compartas.
// Uso: npm run respaldo            (carpeta por defecto: ../backups, o BACKUP_DIR)
//      npm run respaldo -- --sin-secretos   (omite hashes de claves, tokens y codigos)
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const db = require('../src/db');

const SECRETOS = ['clave_hash', 'token', 'token_hash', 'codigo_vinculacion_hash'];

async function main() {
  const sinSecretos = process.argv.includes('--sin-secretos');
  const carpeta = process.env.BACKUP_DIR || path.join(__dirname, '..', '..', 'backups');
  fs.mkdirSync(carpeta, { recursive: true });

  const tablas = (await db.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'pgmigrations' ORDER BY tablename`
  )).rows.map((r) => r.tablename);

  const datos = { generado_en: new Date().toISOString(), sin_secretos: sinSecretos, tablas: {} };
  for (const t of tablas) {
    const { rows } = await db.query(`SELECT * FROM ${t}`);
    datos.tablas[t] = sinSecretos
      ? rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !SECRETOS.includes(k))))
      : rows;
  }
  const migraciones = await db.query('SELECT name, run_on FROM pgmigrations ORDER BY id');
  datos.migraciones = migraciones.rows;

  const nombre = `respaldo-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const destino = path.join(carpeta, nombre);
  fs.writeFileSync(destino, JSON.stringify(datos, null, 2));
  const filas = Object.values(datos.tablas).reduce((s, r) => s + r.length, 0);
  console.log(`Respaldo guardado en ${destino} (${tablas.length} tablas, ${filas} filas)`);
}

main()
  .catch((e) => { console.error('Respaldo fallo:', e.message); process.exitCode = 1; })
  .finally(() => db.pool.end());
