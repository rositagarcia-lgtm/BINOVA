const rateLimit = require('express-rate-limit');

function limitador(windowMs, limit, mensaje) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: mensaje },
  });
}

module.exports = { limitador };
