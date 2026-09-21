const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const app = express();

app.set('trust proxy', 1);
app.use(helmet());
app.use(express.json({ limit: '100kb' }));

const permitidos = (process.env.CORS_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || permitidos.length === 0 || permitidos.includes(origin)) {
      return cb(null, true);
    }
    const error = new Error('Origen no permitido: ' + origin);
    error.status = 403;
    cb(error);
  },
}));

app.use(rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path.startsWith('/api/v1/lecturas'),
}));

app.get('/health', (req, res) => res.json({ ok: true, hora: new Date() }));

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

app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON invalido' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Cuerpo demasiado grande' });
  }
  if (err.status === 403) {
    return res.status(403).json({ error: 'Origen no permitido' });
  }
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

module.exports = app;