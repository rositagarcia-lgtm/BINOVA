-- EJECUTAR SOLO DESPUES de desplegar la API nueva (la que lee token_hash) y comprobar que los dispositivos siguen enviando lecturas.
-- Elimina los tokens de dispositivo guardados en texto plano.

UPDATE contenedores SET token = NULL WHERE token IS NOT NULL;
-- Cuando estes seguro de que no se necesita volver atras:
-- ALTER TABLE contenedores DROP COLUMN token;
