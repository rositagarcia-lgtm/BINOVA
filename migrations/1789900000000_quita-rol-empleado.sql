-- Up Migration

UPDATE usuarios SET rol = 'operario' WHERE rol = 'empleado';

ALTER TABLE usuarios DROP CONSTRAINT usuarios_rol_check;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_check
  CHECK (rol IN ('superadmin', 'admin', 'supervisor', 'operario', 'particular'));

-- Down Migration

ALTER TABLE usuarios DROP CONSTRAINT usuarios_rol_check;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_check
  CHECK (rol IN ('superadmin', 'admin', 'supervisor', 'operario', 'empleado', 'particular'));
