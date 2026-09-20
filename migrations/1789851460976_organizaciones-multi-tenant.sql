-- Up Migration

CREATE TABLE organizaciones (
  id bigserial PRIMARY KEY,
  nombre text NOT NULL,
  tipo text NOT NULL DEFAULT 'empresa' CHECK (tipo IN ('empresa', 'individual')),
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'activa', 'suspendida', 'rechazada')),
  contacto_nombre text,
  contacto_correo text,
  mensaje text,
  creado_en timestamptz NOT NULL DEFAULT now(),
  aprobado_en timestamptz
);

ALTER TABLE usuarios ADD COLUMN organizacion_id bigint REFERENCES organizaciones(id);
ALTER TABLE zonas ADD COLUMN organizacion_id bigint REFERENCES organizaciones(id);
ALTER TABLE carritos ADD COLUMN organizacion_id bigint REFERENCES organizaciones(id);
ALTER TABLE contenedores ADD COLUMN organizacion_id bigint REFERENCES organizaciones(id);
ALTER TABLE contenedores ADD COLUMN codigo_vinculacion_hash text UNIQUE;
ALTER TABLE incidencias ADD COLUMN organizacion_id bigint REFERENCES organizaciones(id);
ALTER TABLE incidencias ADD COLUMN usuario_id bigint REFERENCES usuarios(id);
ALTER TABLE incidencias ADD COLUMN resuelta_por bigint REFERENCES usuarios(id);

DO $$
DECLARE demo_id bigint;
BEGIN
  INSERT INTO organizaciones (nombre, tipo, estado, aprobado_en)
  VALUES ('BINOVA Demo', 'empresa', 'activa', now())
  RETURNING id INTO demo_id;

  UPDATE usuarios SET organizacion_id = demo_id;
  UPDATE zonas SET organizacion_id = demo_id;
  UPDATE carritos SET organizacion_id = demo_id;
  UPDATE contenedores SET organizacion_id = demo_id;
  UPDATE incidencias SET organizacion_id = demo_id;
  UPDATE incidencias i SET usuario_id = t.usuario_id FROM turnos t WHERE t.id = i.turno_id;
END $$;

ALTER TABLE zonas ALTER COLUMN organizacion_id SET NOT NULL;
ALTER TABLE carritos ALTER COLUMN organizacion_id SET NOT NULL;
ALTER TABLE incidencias ALTER COLUMN organizacion_id SET NOT NULL;

ALTER TABLE usuarios DROP CONSTRAINT usuarios_rol_check;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_check
  CHECK (rol IN ('superadmin', 'admin', 'supervisor', 'operario', 'empleado', 'particular'));
ALTER TABLE usuarios ADD CONSTRAINT usuarios_org_check
  CHECK ((rol = 'superadmin' AND organizacion_id IS NULL) OR (rol <> 'superadmin' AND organizacion_id IS NOT NULL));

ALTER TABLE carritos DROP CONSTRAINT carritos_codigo_key;
CREATE UNIQUE INDEX carritos_org_codigo_key ON carritos (organizacion_id, codigo);

ALTER TABLE contenedores DROP CONSTRAINT contenedores_codigo_key;
CREATE UNIQUE INDEX contenedores_org_codigo_key ON contenedores (COALESCE(organizacion_id, 0), codigo);
ALTER TABLE contenedores ALTER COLUMN lat DROP NOT NULL;
ALTER TABLE contenedores ALTER COLUMN lng DROP NOT NULL;

CREATE INDEX ix_usuarios_org ON usuarios (organizacion_id);
CREATE INDEX ix_zonas_org ON zonas (organizacion_id);
CREATE INDEX ix_contenedores_org ON contenedores (organizacion_id) WHERE activo;
CREATE INDEX ix_incidencias_org ON incidencias (organizacion_id, reportada_en DESC);

-- Down Migration
-- Falla a proposito si ya hay datos que violen las restricciones anteriores (codigos repetidos entre organizaciones, roles nuevos, coordenadas nulas).

DROP INDEX ix_incidencias_org;
DROP INDEX ix_contenedores_org;
DROP INDEX ix_zonas_org;
DROP INDEX ix_usuarios_org;

ALTER TABLE contenedores ALTER COLUMN lng SET NOT NULL;
ALTER TABLE contenedores ALTER COLUMN lat SET NOT NULL;
DROP INDEX contenedores_org_codigo_key;
ALTER TABLE contenedores ADD CONSTRAINT contenedores_codigo_key UNIQUE (codigo);

DROP INDEX carritos_org_codigo_key;
ALTER TABLE carritos ADD CONSTRAINT carritos_codigo_key UNIQUE (codigo);

ALTER TABLE usuarios DROP CONSTRAINT usuarios_org_check;
ALTER TABLE usuarios DROP CONSTRAINT usuarios_rol_check;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_check CHECK (rol IN ('operario', 'supervisor', 'admin'));

ALTER TABLE incidencias DROP COLUMN resuelta_por;
ALTER TABLE incidencias DROP COLUMN usuario_id;
ALTER TABLE incidencias DROP COLUMN organizacion_id;
ALTER TABLE contenedores DROP COLUMN codigo_vinculacion_hash;
ALTER TABLE contenedores DROP COLUMN organizacion_id;
ALTER TABLE carritos DROP COLUMN organizacion_id;
ALTER TABLE zonas DROP COLUMN organizacion_id;
ALTER TABLE usuarios DROP COLUMN organizacion_id;

DROP TABLE organizaciones;
