const crypto = require('crypto');

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

module.exports = {
  esId, normalizarCorreo, correoValido, claveValida, texto, num,
  coordenadasValidas, entero, fechaValida,
  generarClave, generarCodigo, generarTokenDispositivo, sha256,
};
