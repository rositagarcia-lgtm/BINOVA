const db = require('../db');

const MINUTOS_SIN_REPORTE = 60;
const BATERIA_BAJA = 20;
const BATERIA_RECUPERADA = 30;

async function abrirAlerta(contenedorId, tipo, nivel) {
  await db.query(
    `INSERT INTO alertas (contenedor_id, tipo, nivel, generada_en)
     SELECT $1::bigint, $2::text, $3::smallint, now()
     WHERE NOT EXISTS (
       SELECT 1 FROM alertas
       WHERE contenedor_id = $1::bigint AND tipo = $2::text AND atendida_en IS NULL
     )
     ON CONFLICT DO NOTHING`,
    [contenedorId, tipo, nivel]
  );
}

async function cerrarAlerta(contenedorId, tipo) {
  await db.query(
    `UPDATE alertas SET atendida_en = now()
     WHERE contenedor_id = $1 AND tipo = $2 AND atendida_en IS NULL`,
    [contenedorId, tipo]
  );
}

async function evaluarLectura({ contenedorId, nivel, estado, bateria }) {
  if (estado === 'rojo') {
    await abrirAlerta(contenedorId, 'llenado_critico', nivel);
  } else {
    await cerrarAlerta(contenedorId, 'llenado_critico');
  }

  if (bateria !== null && bateria <= BATERIA_BAJA) {
    await abrirAlerta(contenedorId, 'bateria_baja', nivel);
  } else if (bateria !== null && bateria > BATERIA_RECUPERADA) {
    await cerrarAlerta(contenedorId, 'bateria_baja');
  }

  await cerrarAlerta(contenedorId, 'sin_reporte');
}

async function generarSinReporte(organizacionId) {
  await db.query(
    `INSERT INTO alertas (contenedor_id, tipo, nivel, generada_en)
     SELECT c.id, 'sin_reporte', c.nivel_actual, now()
     FROM contenedores c
     WHERE c.organizacion_id = $1
       AND c.activo = true
       AND c.device_id IS NOT NULL
       AND c.ultima_lectura_en IS NOT NULL
       AND c.ultima_lectura_en < now() - make_interval(mins => $2::int)
       AND NOT EXISTS (
         SELECT 1 FROM alertas a
         WHERE a.contenedor_id = c.id AND a.tipo = 'sin_reporte' AND a.atendida_en IS NULL
       )
     ON CONFLICT DO NOTHING`,
    [organizacionId, MINUTOS_SIN_REPORTE]
  );
}

async function liberarAlertasDeCarrito(carritoId, cliente = db) {
  await cliente.query(
    `UPDATE alertas SET carrito_id = NULL, tomada_en = NULL
     WHERE carrito_id = $1 AND atendida_en IS NULL`,
    [carritoId]
  );
}

module.exports = { evaluarLectura, generarSinReporte, liberarAlertasDeCarrito, MINUTOS_SIN_REPORTE };
