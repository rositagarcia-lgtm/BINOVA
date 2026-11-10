// Prepara una base NUEVA y vacia: carga db/schema.sql y marca como aplicadas las migraciones base.
// Despues ejecuta "npm run migrate up" para aplicar las migraciones nuevas.
// Uso: npm run db:init      (usa DATABASE_URL; DATABASE_SSL=off para Postgres local)
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const BASE = [
  '1789851460976_organizaciones-multi-tenant',
  '1789854251850_endurece-alertas-y-correos',
  '1789860550668_carritos-por-zona',
  '1789900000000_quita-rol-empleado',
  '1790000000001_invitaciones',
];

async function main() {
  const ssl = process.env.DATABASE_SSL === 'off' ? false : { rejectUnauthorized: false };
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl });
  try {
    const existe = await pool.query(`SELECT to_regclass('public.usuarios') AS t`);
    if (existe.rows[0].t) {
      throw new Error('La base ya tiene tablas. db:init solo sirve para una base vacia.');
    }
    const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
    await pool.query('BEGIN');
    await pool.query(sql);
    await pool.query(`CREATE TABLE IF NOT EXISTS pgmigrations (
      id serial PRIMARY KEY, name varchar(255) NOT NULL, run_on timestamp NOT NULL)`);
    for (const n of BASE) {
      await pool.query('INSERT INTO pgmigrations (name, run_on) VALUES ($1, now())', [n]);
    }
    await pool.query('COMMIT');
    console.log('Esquema base cargado. Ahora ejecuta: npm run migrate up');
  } catch (e) {
    await pool.query('ROLLBACK').catch(() => {});
    console.error('db:init fallo:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
main();
