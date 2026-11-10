const fs = require('fs');
const { Pool } = require('pg');

function configSsl() {
  if (process.env.DATABASE_SSL === 'off') return false;
  const ca = (process.env.DATABASE_CA || '').trim();
  if (ca) {
    const pem = ca.includes('BEGIN CERTIFICATE') ? ca : fs.readFileSync(ca, 'utf8');
    return { ca: pem, rejectUnauthorized: true };
  }
  return { rejectUnauthorized: false };
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: configSsl(),
  max: Number(process.env.DATABASE_POOL_MAX) || 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  application_name: 'binova-api',
});

pool.on('error', (e) => console.error('Error en el pool:', e.message));

async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resultado = await fn(client);
    await client.query('COMMIT');
    return resultado;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

module.exports = {
  query: (text, params) => pool.query(text, params),
  tx,
  pool,
};
