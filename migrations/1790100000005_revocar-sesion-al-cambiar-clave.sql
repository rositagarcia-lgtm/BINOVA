-- Up Migration
-- Permite invalidar tokens emitidos antes de un cambio de clave (robo de sesion, clave filtrada, etc.).
-- Si esta vacio, no afecta a nadie: el chequeo en requireAuth solo se activa cuando hay una fecha.
ALTER TABLE usuarios ADD COLUMN clave_cambiada_en timestamptz;

-- Down Migration
ALTER TABLE usuarios DROP COLUMN clave_cambiada_en;
