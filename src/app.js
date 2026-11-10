const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { fail, manejadorErrores } = require('./errors');
const db = require('./db');
const app = express();

app.set('trust proxy', 1);
app.use(helmet());

// Registro de cada peticion (una linea JSON) con un identificador para seguirla en los logs.
app.use((req, res, next) => {
  const id = req.headers['x-request-id'] || crypto.randomUUID();
  req.id = id;
  res.setHeader('X-Request-Id', id);
  const inicio = process.hrtime.bigint();
  res.on('finish', () => {
    if (process.env.NODE_ENV === 'test' || req.path === '/health') return;
    console.log(JSON.stringify({
      t: new Date().toISOString(), id, metodo: req.method, ruta: req.path,
      estado: res.statusCode, ms: Math.round(Number(process.hrtime.bigint() - inicio) / 1e6), ip: req.ip,
    }));
  });
  next();
});

app.use(express.json({ limit: '100kb' }));

const permitidos = (process.env.CORS_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || permitidos.length === 0 || permitidos.includes(origin)) {
      return cb(null, true);
    }
    cb(fail(403, 'Origen no permitido', 'cors'));
  },
}));

app.use(rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => process.env.NODE_ENV === 'test' || req.path.startsWith('/api/v1/lecturas'),
  message: { error: 'Demasiadas solicitudes, intenta de nuevo mas tarde', codigo: 'demasiadas_solicitudes' },
}));

app.get('/health', (req, res) => res.json({ ok: true, hora: new Date() }));

// Comprueba tambien la base de datos (sirve para mantenerla despierta y detectar caidas).
app.get('/health/db', async (req, res) => {
  try {
    await Promise.race([
      db.query('SELECT 1'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('tiempo agotado')), 5000)),
    ]);
    res.json({ ok: true, base_de_datos: 'ok', hora: new Date() });
  } catch (e) {
    console.error('health/db:', e.message);
    res.status(503).json({ ok: false, base_de_datos: 'sin_conexion', codigo: 'base_no_disponible' });
  }
});

app.use('/api/v1/contenedores', require('./routes/contenedores'));
app.use('/api/v1/lecturas', require('./routes/lecturas'));
app.use('/api/v1/auth', require('./routes/auth'));
app.use('/api/v1/carritos', require('./routes/carritos'));
app.use('/api/v1/turnos', require('./routes/turnos'));
app.use('/api/v1/organizaciones', require('./routes/organizaciones'));
app.use('/api/v1/usuarios', require('./routes/usuarios'));
app.use('/api/v1/zonas', require('./routes/zonas'));
app.use('/api/v1/incidencias', require('./routes/incidencias'));
app.use('/api/v1/alertas', require('./routes/alertas'));
app.use('/api/v1/recolecciones', require('./routes/recolecciones'));
app.use('/api/v1/estadisticas', require('./routes/estadisticas'));
app.use('/api/v1/rutas', require('./routes/rutas'));
app.use('/api/v1/auditoria', require('./routes/auditoria'));

app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada', codigo: 'ruta_no_encontrada' });
});

app.use(manejadorErrores);

module.exports = app;