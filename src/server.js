require('dotenv').config();

if (!process.env.JWT_SECRET) {
  console.error('Falta la variable de entorno JWT_SECRET');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production' && !(process.env.CORS_ORIGINS || '').trim()) {
  console.error('En produccion hay que definir CORS_ORIGINS (lista de origenes permitidos)');
  process.exit(1);
}

const app = require('./app');
const { pool } = require('./db');

const port = process.env.PORT || 3000;
const server = app.listen(port, () => console.log(`API escuchando en el puerto ${port}`));

function apagar() {
  console.log('Apagando servidor...');
  server.close(() => {
    pool.end().then(() => process.exit(0));
  });
}

process.on('SIGTERM', apagar);
process.on('SIGINT', apagar);
process.on('unhandledRejection', (motivo) => {
  console.error('Promesa rechazada sin manejar:', motivo);
});
process.on('uncaughtException', (e) => {
  console.error('Excepcion no capturada:', e);
  process.exit(1);
});
