// Genera db/schema.sql a partir de la base conectada (solo lectura).
// Uso: npm run db:snapshot   (usa DATABASE_URL del .env)
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const SALIDA = path.join(__dirname, '..', 'db', 'schema.sql');

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    const tablas = (await pool.query(`
      SELECT c.oid, c.relname, c.relrowsecurity
      FROM pg_class c
      WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname <> 'pgmigrations'
      ORDER BY c.relname`)).rows;

    const partes = [];
    partes.push('-- Esquema base de BINOVA (instantanea de la base de datos).');
    partes.push('-- Generado con tools/snapshot-esquema.js. NO ejecutar sobre una base que ya tiene tablas.');
    partes.push('-- Para una base nueva usa: npm run db:init');
    partes.push('');

    for (const t of tablas) {
      const cols = (await pool.query(`
        SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS tipo, a.attnotnull,
               pg_get_expr(d.adbin, d.adrelid) AS def
        FROM pg_attribute a
        LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid = $1 AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attnum`, [t.oid])).rows;

      const lineas = cols.map((c) => {
        const serial = c.def && c.def.startsWith(`nextval('${t.relname}_${c.attname}_seq'`);
        if (serial && c.tipo === 'bigint') return `  ${c.attname} bigserial`;
        if (serial && c.tipo === 'integer') return `  ${c.attname} serial`;
        let l = `  ${c.attname} ${c.tipo}`;
        if (c.def) l += ` DEFAULT ${c.def}`;
        if (c.attnotnull) l += ' NOT NULL';
        return l;
      });
      partes.push(`CREATE TABLE ${t.relname} (\n${lineas.join(',\n')}\n);\n`);
    }

    const cons = (await pool.query(`
      SELECT conrelid::regclass::text AS tabla, conname, contype, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE connamespace = 'public'::regnamespace AND conrelid::regclass::text <> 'pgmigrations'
      ORDER BY CASE contype WHEN 'p' THEN 1 WHEN 'u' THEN 2 WHEN 'c' THEN 3 ELSE 4 END, conrelid::regclass::text, conname`)).rows;
    partes.push('-- Restricciones');
    for (const c of cons) partes.push(`ALTER TABLE ${c.tabla} ADD CONSTRAINT ${c.conname} ${c.def};`);
    partes.push('');

    const idx = (await pool.query(`
      SELECT i.indexdef FROM pg_indexes i
      WHERE i.schemaname = 'public' AND i.tablename <> 'pgmigrations'
        AND NOT EXISTS (SELECT 1 FROM pg_constraint k
                        WHERE k.connamespace = 'public'::regnamespace AND k.conname = i.indexname)
      ORDER BY i.tablename, i.indexname`)).rows;
    partes.push('-- Indices');
    for (const i of idx) partes.push(`${i.indexdef.replace('public.', '')};`);
    partes.push('');

    partes.push('-- Seguridad por fila');
    for (const t of tablas.filter((x) => x.relrowsecurity)) partes.push(`ALTER TABLE ${t.relname} ENABLE ROW LEVEL SECURITY;`);
    partes.push('');

    fs.writeFileSync(SALIDA, partes.join('\n'));
    console.log(`Esquema escrito en ${SALIDA} (${tablas.length} tablas, ${cons.length} restricciones, ${idx.length} indices)`);
  } finally {
    await pool.end();
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
