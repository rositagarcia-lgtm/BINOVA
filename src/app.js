const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { fail, manejadorErrores } = require('./errors');
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
    cb(fail(403, 'Origen no permitido', 'cors'));
  },
}));

app.use(rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path.startsWith('/api/v1/lecturas'),
  message: { error: 'Demasiadas solicitudes, intenta de nuevo mas tarde', codigo: 'demasiadas_solicitudes' },
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
  res.status(404).json({ error: 'Ruta no encontrada', codigo: 'ruta_no_encontrada' });
});

app.use(manejadorErrores);

module.exports = app;