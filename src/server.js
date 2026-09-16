require('dotenv').config();
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