-- Up Migration

CREATE INDEX ix_alertas_recoleccion ON alertas (recoleccion_id) WHERE recoleccion_id IS NOT NULL;
CREATE INDEX ix_incidencias_contenedor ON incidencias (contenedor_id);
CREATE INDEX ix_incidencias_usuario ON incidencias (usuario_id);
CREATE INDEX ix_incidencias_turno ON incidencias (turno_id);
CREATE INDEX ix_incidencias_resuelta_por ON incidencias (resuelta_por) WHERE resuelta_por IS NOT NULL;
CREATE INDEX ix_lecturas_medido_en ON lecturas (medido_en);

-- Down Migration

DROP INDEX ix_lecturas_medido_en;
DROP INDEX ix_incidencias_resuelta_por;
DROP INDEX ix_incidencias_turno;
DROP INDEX ix_incidencias_usuario;
DROP INDEX ix_incidencias_contenedor;
DROP INDEX ix_alertas_recoleccion;
