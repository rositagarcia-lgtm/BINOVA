-- OPCIONAL (recomendado). Crea un rol con permisos minimos para que la API NO use el rol postgres.
-- Ejecutar en el editor SQL de Supabase (o con psql) y luego cambiar DATABASE_URL de la API para usar este rol.
-- Las migraciones (npm run migrate) siguen usando el rol postgres.
--
-- 1) Cambia 'CAMBIA_ESTA_CLAVE' por una clave larga y aleatoria antes de ejecutar.
-- 2) Usuario en la cadena de conexion de Supabase: binova_app.<ref-del-proyecto>

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'binova_app') THEN
    CREATE ROLE binova_app LOGIN PASSWORD 'CAMBIA_ESTA_CLAVE' NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO binova_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO binova_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO binova_app;
-- La API no necesita modificar la tabla de migraciones.
REVOKE ALL ON pgmigrations FROM binova_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO binova_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO binova_app;

-- Las tablas tienen RLS activa sin politicas: un rol que no es propietario no veria filas.
-- Se crea una politica por tabla que permite todo SOLO a binova_app.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'pgmigrations' LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS app_total ON %I', t);
    EXECUTE format('CREATE POLICY app_total ON %I FOR ALL TO binova_app USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- Nota: al crear tablas nuevas con una migracion, repite el bloque anterior para esa tabla
-- (o ejecuta de nuevo este archivo completo).
