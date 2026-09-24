-- Up Migration

CREATE TABLE invitaciones (
  id bigserial PRIMARY KEY,
  usuario_id bigint NOT NULL UNIQUE REFERENCES usuarios(id),
  token_hash text NOT NULL UNIQUE,
  expira_en timestamptz NOT NULL,
  usada_en timestamptz,
  creado_en timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_invitaciones_pendientes ON invitaciones (token_hash) WHERE usada_en IS NULL;

-- Down Migration

DROP INDEX ix_invitaciones_pendientes;
DROP TABLE invitaciones;
