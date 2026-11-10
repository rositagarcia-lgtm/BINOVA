const rateLimit = require('express-rate-limit');

function limitador(windowMs, limit, mensaje) {
  return rateLimit({
    windowMs,
    limit,
    skip: () => process.env.NODE_ENV === 'test',
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: mensaje, codigo: 'demasiadas_solicitudes' },
  });
}

module.exports = { limitador };
