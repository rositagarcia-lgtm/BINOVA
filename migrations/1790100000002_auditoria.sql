-- Up Migration

CREATE TABLE auditoria (
  id bigserial PRIMARY KEY,
  creado_en timestamptz NOT NULL DEFAULT now(),
  usuario_id bigint REFERENCES usuarios(id) ON DELETE SET NULL,
  organizacion_id bigint REFERENCES organizaciones(id) ON DELETE SET NULL,
  accion text NOT NULL,
  entidad text,
  entidad_id bigint,
  detalle jsonb
);

CREATE INDEX ix_auditoria_org ON auditoria (organizacion_id, creado_en DESC);
CREATE INDEX ix_auditoria_fecha ON auditoria (creado_en DESC);
CREATE INDEX ix_auditoria_usuario ON auditoria (usuario_id);
ALTER TABLE auditoria ENABLE ROW LEVEL SECURITY;

-- Down Migration

DROP INDEX ix_auditoria_usuario;
DROP INDEX ix_auditoria_fecha;
DROP INDEX ix_auditoria_org;
DROP TABLE auditoria;
