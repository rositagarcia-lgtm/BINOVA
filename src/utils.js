const crypto = require('crypto');
const { validacion } = require('./errors');

const esId = (v) => /^\d+$/.test(String(v));
const normalizarCorreo = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '');
const correoValido = (v) => v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const claveValida = (v) => typeof v === 'string' && v.length >= 8 && v.length <= 72;
const texto = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

const num = (v) => {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') return Number(v);
  return NaN;
};

const coordenadasValidas = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng)
  && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

const entero = (v, min, max) => {
  const n = num(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

const fechaValida = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

const generarClave = () => crypto.randomBytes(9).toString('base64url');
const generarCodigo = () => crypto.randomBytes(16).toString('base64url');
const generarTokenDispositivo = () => 'tk_' + crypto.randomBytes(24).toString('hex');
const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');

const hashIgual = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
};

// ?limite=...&desde=... (por defecto 500 filas, maximo 1000)
function paginacion(query, { porDefecto = 500, max = 1000 } = {}) {
  const limite = query.limite === undefined ? porDefecto : entero(query.limite, 1, max);
  const desde = query.desde === undefined ? 0 : entero(query.desde, 0, 100000000);
  if (limite === null) throw validacion(`limite debe ser un entero entre 1 y ${max}`);
  if (desde === null) throw validacion('desde debe ser un entero mayor o igual a 0');
  return { limite, desde };
}

module.exports = {
  hashIgual, paginacion,
  esId, normalizarCorreo, correoValido, claveValida, texto, num,
  coordenadasValidas, entero, fechaValida,
  generarClave, generarCodigo, generarTokenDispositivo, sha256,
};
