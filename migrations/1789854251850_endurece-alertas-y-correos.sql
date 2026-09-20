-- Up Migration

CREATE UNIQUE INDEX un_alerta_pendiente ON alertas (contenedor_id, tipo) WHERE atendida_en IS NULL;
CREATE UNIQUE INDEX usuarios_correo_lower_key ON usuarios (lower(correo));

-- Down Migration

DROP INDEX usuarios_correo_lower_key;
DROP INDEX un_alerta_pendiente;
