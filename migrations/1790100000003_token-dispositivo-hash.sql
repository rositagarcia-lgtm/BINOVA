-- Up Migration
-- Guarda el hash (sha256) del token de cada dispositivo. La columna token (texto plano) se conserva
-- por ahora para que la version anterior de la API siga funcionando durante el despliegue.
-- Despues del despliegue: ver db/pendientes/quitar-token-plano.sql

ALTER TABLE contenedores ADD COLUMN token_hash text;

UPDATE contenedores
SET token_hash = encode(sha256(convert_to(token, 'UTF8')), 'hex')
WHERE token IS NOT NULL AND token_hash IS NULL;

CREATE UNIQUE INDEX contenedores_token_hash_key ON contenedores (token_hash) WHERE token_hash IS NOT NULL;

-- Down Migration

DROP INDEX contenedores_token_hash_key;
ALTER TABLE contenedores DROP COLUMN token_hash;
