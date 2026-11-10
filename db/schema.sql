-- Esquema base de BINOVA (instantanea de la base de datos).
-- Generado con tools/snapshot-esquema.js. NO ejecutar sobre una base que ya tiene tablas.
-- Para una base nueva usa: npm run db:init

CREATE TABLE alertas (
  id bigserial,
  contenedor_id bigint NOT NULL,
  tipo text NOT NULL,
  nivel smallint,
  generada_en timestamp with time zone DEFAULT now() NOT NULL,
  atendida_en timestamp with time zone,
  recoleccion_id bigint,
  carrito_id bigint,
  tomada_en timestamp with time zone
);

CREATE TABLE carritos (
  id bigserial,
  codigo text NOT NULL,
  placa text,
  descripcion text,
  capacidad_l integer,
  activo boolean DEFAULT true NOT NULL,
  ult_lat numeric(10,7),
  ult_lng numeric(10,7),
  ult_posicion_en timestamp with time zone,
  organizacion_id bigint NOT NULL,
  zona_id bigint
);

CREATE TABLE contenedores (
  id bigserial,
  codigo text NOT NULL,
  nombre text NOT NULL,
  zona_id bigint,
  lat numeric(10,7),
  lng numeric(10,7),
  altura_cm numeric(6,2) NOT NULL,
  umbral_ambar smallint DEFAULT 50 NOT NULL,
  umbral_rojo smallint DEFAULT 80 NOT NULL,
  device_id text,
  token text,
  nivel_actual smallint,
  estado text,
  ultima_lectura_en timestamp with time zone,
  activo boolean DEFAULT true NOT NULL,
  organizacion_id bigint,
  codigo_vinculacion_hash text
);

CREATE TABLE incidencias (
  id bigserial,
  contenedor_id bigint,
  turno_id bigint,
  tipo text NOT NULL,
  descripcion text,
  foto_url text,
  reportada_en timestamp with time zone DEFAULT now() NOT NULL,
  resuelta_en timestamp with time zone,
  organizacion_id bigint NOT NULL,
  usuario_id bigint,
  resuelta_por bigint
);

CREATE TABLE invitaciones (
  id bigserial,
  usuario_id bigint NOT NULL,
  token_hash text NOT NULL,
  expira_en timestamp with time zone NOT NULL,
  usada_en timestamp with time zone,
  creado_en timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE lecturas (
  id bigserial,
  contenedor_id bigint NOT NULL,
  distancia_cm numeric(6,2) NOT NULL,
  nivel smallint NOT NULL,
  bateria smallint,
  rssi smallint,
  medido_en timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE organizaciones (
  id bigserial,
  nombre text NOT NULL,
  tipo text DEFAULT 'empresa'::text NOT NULL,
  estado text DEFAULT 'pendiente'::text NOT NULL,
  contacto_nombre text,
  contacto_correo text,
  mensaje text,
  creado_en timestamp with time zone DEFAULT now() NOT NULL,
  aprobado_en timestamp with time zone
);

CREATE TABLE recolecciones (
  id bigserial,
  contenedor_id bigint NOT NULL,
  turno_id bigint NOT NULL,
  nivel_antes smallint,
  lat numeric(10,7),
  lng numeric(10,7),
  registrado_en timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE turnos (
  id bigserial,
  usuario_id bigint NOT NULL,
  carrito_id bigint NOT NULL,
  inicio timestamp with time zone DEFAULT now() NOT NULL,
  fin timestamp with time zone
);

CREATE TABLE usuarios (
  id bigserial,
  nombre text NOT NULL,
  correo text NOT NULL,
  clave_hash text NOT NULL,
  rol text DEFAULT 'operario'::text NOT NULL,
  activo boolean DEFAULT true NOT NULL,
  creado_en timestamp with time zone DEFAULT now() NOT NULL,
  organizacion_id bigint
);

CREATE TABLE zonas (
  id bigserial,
  nombre text NOT NULL,
  descripcion text,
  organizacion_id bigint NOT NULL
);

-- Restricciones
ALTER TABLE alertas ADD CONSTRAINT alertas_pkey PRIMARY KEY (id);
ALTER TABLE carritos ADD CONSTRAINT carritos_pkey PRIMARY KEY (id);
ALTER TABLE contenedores ADD CONSTRAINT contenedores_pkey PRIMARY KEY (id);
ALTER TABLE incidencias ADD CONSTRAINT incidencias_pkey PRIMARY KEY (id);
ALTER TABLE invitaciones ADD CONSTRAINT invitaciones_pkey PRIMARY KEY (id);
ALTER TABLE lecturas ADD CONSTRAINT lecturas_pkey PRIMARY KEY (id);
ALTER TABLE organizaciones ADD CONSTRAINT organizaciones_pkey PRIMARY KEY (id);
ALTER TABLE recolecciones ADD CONSTRAINT recolecciones_pkey PRIMARY KEY (id);
ALTER TABLE turnos ADD CONSTRAINT turnos_pkey PRIMARY KEY (id);
ALTER TABLE usuarios ADD CONSTRAINT usuarios_pkey PRIMARY KEY (id);
ALTER TABLE zonas ADD CONSTRAINT zonas_pkey PRIMARY KEY (id);
ALTER TABLE carritos ADD CONSTRAINT carritos_placa_key UNIQUE (placa);
ALTER TABLE contenedores ADD CONSTRAINT contenedores_codigo_vinculacion_hash_key UNIQUE (codigo_vinculacion_hash);
ALTER TABLE contenedores ADD CONSTRAINT contenedores_device_id_key UNIQUE (device_id);
ALTER TABLE invitaciones ADD CONSTRAINT invitaciones_token_hash_key UNIQUE (token_hash);
ALTER TABLE invitaciones ADD CONSTRAINT invitaciones_usuario_id_key UNIQUE (usuario_id);
ALTER TABLE usuarios ADD CONSTRAINT usuarios_correo_key UNIQUE (correo);
ALTER TABLE alertas ADD CONSTRAINT alertas_tipo_check CHECK ((tipo = ANY (ARRAY['llenado_critico'::text, 'bateria_baja'::text, 'sin_reporte'::text])));
ALTER TABLE carritos ADD CONSTRAINT carritos_capacidad_l_check CHECK (((capacidad_l IS NULL) OR (capacidad_l > 0)));
ALTER TABLE contenedores ADD CONSTRAINT contenedores_altura_cm_check CHECK ((altura_cm > (0)::numeric));
ALTER TABLE contenedores ADD CONSTRAINT contenedores_check CHECK ((umbral_rojo > umbral_ambar));
ALTER TABLE contenedores ADD CONSTRAINT contenedores_estado_check CHECK ((estado = ANY (ARRAY['verde'::text, 'ambar'::text, 'rojo'::text])));
ALTER TABLE contenedores ADD CONSTRAINT contenedores_nivel_actual_check CHECK (((nivel_actual >= 0) AND (nivel_actual <= 100)));
ALTER TABLE contenedores ADD CONSTRAINT contenedores_umbral_ambar_check CHECK (((umbral_ambar >= 0) AND (umbral_ambar <= 100)));
ALTER TABLE contenedores ADD CONSTRAINT contenedores_umbral_rojo_check CHECK (((umbral_rojo >= 0) AND (umbral_rojo <= 100)));
ALTER TABLE incidencias ADD CONSTRAINT incidencias_tipo_check CHECK ((tipo = ANY (ARRAY['tapa_danada'::text, 'sensor_sucio'::text, 'acceso_bloqueado'::text, 'otro'::text])));
ALTER TABLE lecturas ADD CONSTRAINT lecturas_bateria_check CHECK (((bateria >= 0) AND (bateria <= 100)));
ALTER TABLE lecturas ADD CONSTRAINT lecturas_distancia_cm_check CHECK ((distancia_cm >= (0)::numeric));
ALTER TABLE lecturas ADD CONSTRAINT lecturas_nivel_check CHECK (((nivel >= 0) AND (nivel <= 100)));
ALTER TABLE organizaciones ADD CONSTRAINT organizaciones_estado_check CHECK ((estado = ANY (ARRAY['pendiente'::text, 'activa'::text, 'suspendida'::text, 'rechazada'::text])));
ALTER TABLE organizaciones ADD CONSTRAINT organizaciones_tipo_check CHECK ((tipo = ANY (ARRAY['empresa'::text, 'individual'::text])));
ALTER TABLE recolecciones ADD CONSTRAINT recolecciones_nivel_antes_check CHECK (((nivel_antes >= 0) AND (nivel_antes <= 100)));
ALTER TABLE turnos ADD CONSTRAINT turnos_check CHECK (((fin IS NULL) OR (fin >= inicio)));
ALTER TABLE usuarios ADD CONSTRAINT usuarios_org_check CHECK ((((rol = 'superadmin'::text) AND (organizacion_id IS NULL)) OR ((rol <> 'superadmin'::text) AND (organizacion_id IS NOT NULL))));
ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_check CHECK ((rol = ANY (ARRAY['superadmin'::text, 'admin'::text, 'supervisor'::text, 'operario'::text, 'particular'::text])));
ALTER TABLE alertas ADD CONSTRAINT alertas_carrito_id_fkey FOREIGN KEY (carrito_id) REFERENCES carritos(id);
ALTER TABLE alertas ADD CONSTRAINT alertas_contenedor_id_fkey FOREIGN KEY (contenedor_id) REFERENCES contenedores(id);
ALTER TABLE alertas ADD CONSTRAINT alertas_recoleccion_id_fkey FOREIGN KEY (recoleccion_id) REFERENCES recolecciones(id);
ALTER TABLE carritos ADD CONSTRAINT carritos_organizacion_id_fkey FOREIGN KEY (organizacion_id) REFERENCES organizaciones(id);
ALTER TABLE carritos ADD CONSTRAINT carritos_zona_id_fkey FOREIGN KEY (zona_id) REFERENCES zonas(id);
ALTER TABLE contenedores ADD CONSTRAINT contenedores_organizacion_id_fkey FOREIGN KEY (organizacion_id) REFERENCES organizaciones(id);
ALTER TABLE contenedores ADD CONSTRAINT contenedores_zona_id_fkey FOREIGN KEY (zona_id) REFERENCES zonas(id);
ALTER TABLE incidencias ADD CONSTRAINT incidencias_contenedor_id_fkey FOREIGN KEY (contenedor_id) REFERENCES contenedores(id);
ALTER TABLE incidencias ADD CONSTRAINT incidencias_organizacion_id_fkey FOREIGN KEY (organizacion_id) REFERENCES organizaciones(id);
ALTER TABLE incidencias ADD CONSTRAINT incidencias_resuelta_por_fkey FOREIGN KEY (resuelta_por) REFERENCES usuarios(id);
ALTER TABLE incidencias ADD CONSTRAINT incidencias_turno_id_fkey FOREIGN KEY (turno_id) REFERENCES turnos(id);
ALTER TABLE incidencias ADD CONSTRAINT incidencias_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES usuarios(id);
ALTER TABLE invitaciones ADD CONSTRAINT invitaciones_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES usuarios(id);
ALTER TABLE lecturas ADD CONSTRAINT lecturas_contenedor_id_fkey FOREIGN KEY (contenedor_id) REFERENCES contenedores(id);
ALTER TABLE recolecciones ADD CONSTRAINT recolecciones_contenedor_id_fkey FOREIGN KEY (contenedor_id) REFERENCES contenedores(id);
ALTER TABLE recolecciones ADD CONSTRAINT recolecciones_turno_id_fkey FOREIGN KEY (turno_id) REFERENCES turnos(id);
ALTER TABLE turnos ADD CONSTRAINT turnos_carrito_id_fkey FOREIGN KEY (carrito_id) REFERENCES carritos(id);
ALTER TABLE turnos ADD CONSTRAINT turnos_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES usuarios(id);
ALTER TABLE usuarios ADD CONSTRAINT usuarios_organizacion_id_fkey FOREIGN KEY (organizacion_id) REFERENCES organizaciones(id);
ALTER TABLE zonas ADD CONSTRAINT zonas_organizacion_id_fkey FOREIGN KEY (organizacion_id) REFERENCES organizaciones(id);

-- Indices
CREATE INDEX ix_alertas_carrito ON alertas USING btree (carrito_id) WHERE (atendida_en IS NULL);
CREATE INDEX ix_alertas_pendientes ON alertas USING btree (contenedor_id) WHERE (atendida_en IS NULL);
CREATE UNIQUE INDEX un_alerta_pendiente ON alertas USING btree (contenedor_id, tipo) WHERE (atendida_en IS NULL);
CREATE UNIQUE INDEX carritos_org_codigo_key ON carritos USING btree (organizacion_id, codigo);
CREATE INDEX ix_carritos_zona ON carritos USING btree (zona_id);
CREATE UNIQUE INDEX contenedores_org_codigo_key ON contenedores USING btree (COALESCE(organizacion_id, (0)::bigint), codigo);
CREATE INDEX ix_contenedores_estado ON contenedores USING btree (estado) WHERE activo;
CREATE INDEX ix_contenedores_org ON contenedores USING btree (organizacion_id) WHERE activo;
CREATE INDEX ix_contenedores_zona ON contenedores USING btree (zona_id);
CREATE INDEX ix_incidencias_org ON incidencias USING btree (organizacion_id, reportada_en DESC);
CREATE INDEX ix_incidencias_pendientes ON incidencias USING btree (reportada_en DESC) WHERE (resuelta_en IS NULL);
CREATE INDEX ix_invitaciones_pendientes ON invitaciones USING btree (token_hash) WHERE (usada_en IS NULL);
CREATE INDEX ix_lecturas_contenedor_fecha ON lecturas USING btree (contenedor_id, medido_en DESC);
CREATE INDEX ix_recolecciones_contenedor ON recolecciones USING btree (contenedor_id, registrado_en DESC);
CREATE INDEX ix_recolecciones_turno ON recolecciones USING btree (turno_id);
CREATE INDEX ix_turnos_carrito_abierto ON turnos USING btree (carrito_id) WHERE (fin IS NULL);
CREATE UNIQUE INDEX un_turno_abierto_por_usuario ON turnos USING btree (usuario_id) WHERE (fin IS NULL);
CREATE INDEX ix_usuarios_org ON usuarios USING btree (organizacion_id);
CREATE UNIQUE INDEX usuarios_correo_lower_key ON usuarios USING btree (lower(correo));
CREATE INDEX ix_zonas_org ON zonas USING btree (organizacion_id);

-- Seguridad por fila
ALTER TABLE alertas ENABLE ROW LEVEL SECURITY;
ALTER TABLE carritos ENABLE ROW LEVEL SECURITY;
ALTER TABLE contenedores ENABLE ROW LEVEL SECURITY;
ALTER TABLE incidencias ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE lecturas ENABLE ROW LEVEL SECURITY;
ALTER TABLE recolecciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE turnos ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE zonas ENABLE ROW LEVEL SECURITY;
