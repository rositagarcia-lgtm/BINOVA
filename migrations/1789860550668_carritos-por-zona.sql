-- Up Migration

ALTER TABLE carritos ADD COLUMN zona_id bigint REFERENCES zonas(id);
ALTER TABLE alertas ADD COLUMN carrito_id bigint REFERENCES carritos(id);
ALTER TABLE alertas ADD COLUMN tomada_en timestamptz;

CREATE INDEX ix_carritos_zona ON carritos (zona_id);
CREATE INDEX ix_alertas_carrito ON alertas (carrito_id) WHERE atendida_en IS NULL;

-- Down Migration

DROP INDEX ix_alertas_carrito;
DROP INDEX ix_carritos_zona;
ALTER TABLE alertas DROP COLUMN tomada_en;
ALTER TABLE alertas DROP COLUMN carrito_id;
ALTER TABLE carritos DROP COLUMN zona_id;
