-- Up Migration

CREATE TABLE recuperaciones_clave (
  id bigserial PRIMARY KEY,
  usuario_id bigint NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expira_en timestamptz NOT NULL,
  usada_en timestamptz,
  creado_en timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_recuperaciones_usuario ON recuperaciones_clave (usuario_id) WHERE usada_en IS NULL;
ALTER TABLE recuperaciones_clave ENABLE ROW LEVEL SECURITY;

-- Down Migration

DROP INDEX ix_recuperaciones_usuario;
DROP TABLE recuperaciones_clave;
