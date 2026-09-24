class HttpError extends Error {
  constructor(status, mensaje, codigo) {
    super(mensaje);
    this.name = 'HttpError';
    this.status = status;
    this.codigo = codigo;
  }
}

function fail(status, mensaje, codigo) {
  return new HttpError(status, mensaje, codigo);
}

const validacion = (m) => fail(400, m, 'validacion');
const noAutenticado = (m) => fail(401, m, 'no_autenticado');
const credenciales = (m) => fail(401, m, 'credenciales');
const tokenInvalido = (m) => fail(401, m, 'token_invalido');
const prohibido = (m) => fail(403, m, 'prohibido');
const orgInactiva = (m) => fail(403, m, 'org_inactiva');
const noEncontrado = (m) => fail(404, m, 'no_encontrado');
const conflicto = (m) => fail(409, m, 'conflicto');
const cuentaPendiente = (m) => fail(403, m, 'cuenta_pendiente');
const invitacionInvalida = (m) => fail(404, m, 'invitacion_invalida');
const invitacionExpirada = (m) => fail(409, m, 'invitacion_expirada');
const invitacionUsada = (m) => fail(409, m, 'invitacion_usada');
const interno = (m) => fail(500, m, 'interno');

const UNICOS = {
  usuarios_correo_lower_key: ['Ya existe un usuario con ese correo', 'correo_duplicado'],
  usuarios_correo_key: ['Ya existe un usuario con ese correo', 'correo_duplicado'],
  contenedores_org_codigo_key: ['Ya existe un contenedor con ese codigo', 'contenedor_codigo_duplicado'],
  contenedores_codigo_key: ['Ya existe un contenedor con ese codigo', 'contenedor_codigo_duplicado'],
  contenedores_device_id_key: ['Ya existe un contenedor con ese device_id', 'device_id_duplicado'],
  contenedores_codigo_vinculacion_hash_key: ['Ese codigo de vinculacion ya esta en uso', 'codigo_vinculacion_duplicado'],
  carritos_org_codigo_key: ['Ya existe un carrito con ese codigo', 'carrito_codigo_duplicado'],
  carritos_codigo_key: ['Ya existe un carrito con ese codigo', 'carrito_codigo_duplicado'],
  carritos_placa_key: ['Ya existe un carrito con esa placa', 'placa_duplicada'],
  un_alerta_pendiente: ['Ya hay una alerta pendiente de ese tipo para este contenedor', 'alerta_duplicada'],
};

function mapearUnico(err) {
  const nombre = err.constraint || '';
  if (UNICOS[nombre]) {
    const [mensaje, codigo] = UNICOS[nombre];
    return fail(409, mensaje, codigo);
  }
  const blob = `${nombre} ${err.detail || ''} ${err.table || ''}`.toLowerCase();
  if (blob.includes('correo')) {
    return fail(409, 'Ya existe un usuario con ese correo', 'correo_duplicado');
  }
  if (blob.includes('device_id')) {
    return fail(409, 'Ya existe un contenedor con ese device_id', 'device_id_duplicado');
  }
  if (blob.includes('codigo_vinculacion')) {
    return fail(409, 'Ese codigo de vinculacion ya esta en uso', 'codigo_vinculacion_duplicado');
  }
  if (blob.includes('placa')) {
    return fail(409, 'Ya existe un carrito con esa placa', 'placa_duplicada');
  }
  if (blob.includes('contenedor')) {
    return fail(409, 'Ya existe un contenedor con ese codigo', 'contenedor_codigo_duplicado');
  }
  if (blob.includes('carrito')) {
    return fail(409, 'Ya existe un carrito con ese codigo', 'carrito_codigo_duplicado');
  }
  if (blob.includes('turno')) {
    return fail(409, 'Ya tienes un turno abierto o el carrito ya esta en uso', 'turno_duplicado');
  }
  return fail(409, 'Ya existe un registro con esos datos', 'duplicado');
}

function mapearPostgres(err) {
  if (!err || typeof err.code !== 'string') return null;
  if (err.code === '23505') return mapearUnico(err);
  if (err.code === '23503') {
    return fail(409, 'No se puede completar: hay una referencia invalida', 'referencia_invalida');
  }
  if (err.code === '23514') return fail(400, 'Valores fuera de rango', 'valor_invalido');
  if (err.code === '23502') return fail(400, 'Faltan datos obligatorios', 'validacion');
  return null;
}

function manejadorErrores(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON invalido', codigo: 'json_invalido' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Cuerpo demasiado grande', codigo: 'cuerpo_grande' });
  }

  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, codigo: err.codigo });
  }

  const pg = mapearPostgres(err);
  if (pg) {
    return res.status(pg.status).json({ error: pg.message, codigo: pg.codigo });
  }

  if (err.status === 403) {
    return res.status(403).json({ error: 'Origen no permitido', codigo: 'cors' });
  }

  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor', codigo: 'interno' });
}

module.exports = {
  HttpError,
  fail,
  validacion,
  noAutenticado,
  credenciales,
  tokenInvalido,
  prohibido,
  orgInactiva,
  noEncontrado,
  conflicto,
  cuentaPendiente,
  invitacionInvalida,
  invitacionExpirada,
  invitacionUsada,
  interno,
  mapearPostgres,
  manejadorErrores,
};
