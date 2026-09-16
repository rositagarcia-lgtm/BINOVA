const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  application_name: 'binova-api',
});

pool.on('error', (e) => console.error('Error en el pool:', e.message));

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};