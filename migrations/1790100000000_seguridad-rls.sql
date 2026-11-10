-- Up Migration
-- Cierra el acceso de los roles publicos de Supabase (anon / authenticated) a las tablas del esquema public.
-- La API se conecta con el rol postgres, que no se ve afectado.

ALTER TABLE organizaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE pgmigrations ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
    END IF;
  END LOOP;
END $$;

-- Down Migration
-- No se devuelven los permisos a anon/authenticated a proposito.

ALTER TABLE pgmigrations DISABLE ROW LEVEL SECURITY;
ALTER TABLE organizaciones DISABLE ROW LEVEL SECURITY;
