const express = require('express');
const { noEncontrado, validacion } = require('../errors');
const db = require('../db');
const { requireAuth, requireRol } = require('../middleware/auth');
const {
  esId, texto, num, entero, coordenadasValidas, generarCodigo, generarTokenDispositivo, sha256,
} = require('../utils');
const router = express.Router();

const ROLES_ORG = ['admin', 'supervisor', 'operario', 'particular'];

function validarUmbrales(ambar, rojo) {
  return Number.isInteger(ambar) && Number.isInteger(rojo) && ambar >= 0 && rojo <= 100 && rojo > ambar;
}

function leerUmbrales(b) {
  const ambar = b.umbral_ambar === undefined ? 50 : num(b.umbral_ambar);
  const rojo = b.umbral_rojo === undefined ? 80 : num(b.umbral_rojo);
  return { ambar, rojo, validos: validarUmbrales(ambar, rojo) };
}

router.get('/', requireAuth, requireRol(...ROLES_ORG), async (req, res, next) => {
  try {
    const { zona_id: zonaId, estado } = req.query;
    if (zonaId !== undefined && !esId(zonaId)) {
      return next(validacion('zona_id invalido'));
    }
    if (estado !== undefined && !['verde', 'ambar', 'rojo'].includes(estado)) {
      return next(validacion('estado debe ser verde, ambar o rojo'));
    }

    const { rows } = await db.query(`
      SELECT c.id, c.codigo, c.nombre, c.zona_id, c.lat, c.lng,
             c.nivel_actual, c.estado, c.ultima_lectura_en,
             z.nombre AS zona
      FROM contenedores c
      LEFT JOIN zonas z ON z.id = c.zona_id
      WHERE c.activo = true AND c.organizacion_id = $1
        AND ($2::bigint IS NULL OR c.zona_id = $2::bigint)
        AND ($3::text IS NULL OR c.estado = $3)
      ORDER BY c.nivel_actual DESC NULLS LAST
    `, [req.usuario.organizacion_id, zonaId ?? null, estado ?? null]);
    res.json(rows);
  } catch (e) { next(e); }
});

router.get('/:id/historico', requireAuth, requireRol(...ROLES_ORG), async (req, res, next) => {
  try {
    if (!esId(req.params.id)) {
      return next(validacion('id invalido'));
    }
    const propio = await db.query(
      `SELECT id FROM contenedores WHERE id = $1 AND organizacion_id = $2`,
      [req.params.id, req.usuario.organizacion_id]
    );
    if (propio.rows.length === 0) {
      return next(noEncontrado('Contenedor no encontrado'));
    }

    const limite = req.query.limite === undefined ? 200 : entero(req.query.limite, 1, 1000);
    if (limite === null) {
      return next(validacion('limite debe ser un entero entre 1 y 1000'));
    }

    const { rows } = await db.query(`
      SELECT nivel, bateria, medido_en
      FROM lecturas
      WHERE contenedor_id = $1
      ORDER BY medido_en DESC
      LIMIT $2
    `, [req.params.id, limite]);
    res.json(rows);
  } catch (e) { next(e); }
});

router.get('/:id', requireAuth, requireRol(...ROLES_ORG), async (req, res, next) => {
  try {
    if (!esId(req.params.id)) {
      return next(validacion('id invalido'));
    }
    const { rows } = await db.query(`
      SELECT c.id, c.codigo, c.nombre, c.zona_id, z.nombre AS zona, c.lat, c.lng,
             c.altura_cm, c.umbral_ambar, c.umbral_rojo, c.nivel_actual, c.estado,
             c.ultima_lectura_en, c.activo, c.device_id,
             (SELECT l.bateria FROM lecturas l WHERE l.contenedor_id = c.id
              ORDER BY l.medido_en DESC LIMIT 1) AS bateria
      FROM contenedores c
      LEFT JOIN zonas z ON z.id = c.zona_id
      WHERE c.id = $1 AND c.organizacion_id = $2
    `, [req.params.id, req.usuario.organizacion_id]);
    if (rows.length === 0) {
      return next(noEncontrado('Contenedor no encontrado'));
    }
    const contenedor = rows[0];
    if (req.usuario.rol !== 'admin') {
      delete contenedor.device_id;
    }
    res.json(contenedor);
  } catch (e) { next(e); }
});

router.patch('/:id', requireAuth, requireRol('admin'), async (req, res, next) => {
  try {
    if (!esId(req.params.id)) {
      return next(validacion('id invalido'));
    }
    const b = req.body ?? {};
    const org = req.usuario.organizacion_id;

    const actual = await db.query(
      `SELECT id, umbral_ambar, umbral_rojo, device_id FROM contenedores WHERE id = $1 AND organizacion_id = $2`,
      [req.params.id, org]
    );
    if (actual.rows.length === 0) {
      return next(noEncontrado('Contenedor no encontrado'));
    }

    const columnas = [];
    const valores = [];
    const poner = (columna, valor) => {
      valores.push(valor);
      columnas.push(`${columna} = $${valores.length}`);
    };

    if (b.nombre !== undefined) {
      const nombre = texto(b.nombre, 120);
      if (!nombre) return next(validacion('nombre invalido'));
      poner('nombre', nombre);
    }
    if (b.zona_id !== undefined) {
      if (b.zona_id === null) {
        poner('zona_id', null);
      } else {
        if (!esId(b.zona_id)) return next(validacion('zona_id invalido'));
        const zona = await db.query(
          `SELECT id FROM zonas WHERE id = $1 AND organizacion_id = $2`,
          [b.zona_id, org]
        );
        if (zona.rows.length === 0) return next(noEncontrado('Zona no encontrada'));
        poner('zona_id', zona.rows[0].id);
      }
    }
    if (b.lat !== undefined || b.lng !== undefined) {
      const lat = num(b.lat);
      const lng = num(b.lng);
      if (!coordenadasValidas(lat, lng)) {
        return next(validacion('lat y lng deben enviarse juntos y ser validos'));
      }
      poner('lat', lat);
      poner('lng', lng);
    }
    if (b.altura_cm !== undefined) {
      const altura = num(b.altura_cm);
      if (!Number.isFinite(altura) || altura <= 0) {
        return next(validacion('altura_cm debe ser mayor que 0'));
      }
      poner('altura_cm', altura);
    }
    if (b.umbral_ambar !== undefined || b.umbral_rojo !== undefined) {
      const ambar = b.umbral_ambar === undefined ? actual.rows[0].umbral_ambar : num(b.umbral_ambar);
      const rojo = b.umbral_rojo === undefined ? actual.rows[0].umbral_rojo : num(b.umbral_rojo);
      if (!validarUmbrales(ambar, rojo)) {
        return next(validacion('Umbrales invalidos: enteros de 0 a 100 y umbral_rojo mayor que umbral_ambar'));
      }
      poner('umbral_ambar', ambar);
      poner('umbral_rojo', rojo);
    }
    if (b.activo !== undefined) {
      if (typeof b.activo !== 'boolean') return next(validacion('activo debe ser true o false'));
      poner('activo', b.activo);
    }

    let tokenNuevo = null;
    if (b.device_id !== undefined) {
      const deviceId = b.device_id === null ? null : texto(b.device_id, 80);
      if (b.device_id !== null && !deviceId) return next(validacion('device_id invalido'));
      poner('device_id', deviceId);
      if (deviceId !== actual.rows[0].device_id) {
        tokenNuevo = deviceId ? generarTokenDispositivo() : null;
        poner('token', tokenNuevo);
      }
    }
    if (b.regenerar_token === true && tokenNuevo === null) {
      const deviceId = b.device_id === undefined ? actual.rows[0].device_id : texto(b.device_id, 80);
      if (!deviceId) return next(validacion('El contenedor no tiene device_id'));
      tokenNuevo = generarTokenDispositivo();
      poner('token', tokenNuevo);
    }

    if (columnas.length === 0) {
      return next(validacion('No hay nada que actualizar'));
    }

    valores.push(req.params.id, org);
    const { rows } = await db.query(
      `UPDATE contenedores SET ${columnas.join(', ')}
       WHERE id = $${valores.length - 1} AND organizacion_id = $${valores.length}
       RETURNING id, codigo, nombre, zona_id, lat, lng, altura_cm, umbral_ambar, umbral_rojo, device_id, activo`,
      valores
    );
    res.json(tokenNuevo ? { ...rows[0], token: tokenNuevo } : rows[0]);
  } catch (e) { next(e); }
});

router.post('/', requireAuth, requireRol('admin'), async (req, res, next) => {
  try {
    const b = req.body ?? {};
    const codigo = texto(b.codigo, 40);
    const nombre = texto(b.nombre, 120);
    const deviceId = texto(b.device_id, 80);
    const lat = num(b.lat);
    const lng = num(b.lng);
    const altura = num(b.altura_cm);
    const { ambar, rojo, validos } = leerUmbrales(b);

    if (!codigo || !nombre) {
      return next(validacion('Faltan codigo o nombre'));
    }
    if (!coordenadasValidas(lat, lng)) {
      return next(validacion('lat/lng invalidos'));
    }
    if (!Number.isFinite(altura) || altura <= 0) {
      return next(validacion('altura_cm debe ser mayor que 0'));
    }
    if (!validos) {
      return next(validacion('Umbrales invalidos: enteros de 0 a 100 y umbral_rojo mayor que umbral_ambar'));
    }

    let zonaId = null;
    if (b.zona_id !== undefined && b.zona_id !== null) {
      if (!esId(b.zona_id)) {
        return next(validacion('zona_id invalido'));
      }
      const zona = await db.query(
        `SELECT id FROM zonas WHERE id = $1 AND organizacion_id = $2`,
        [b.zona_id, req.usuario.organizacion_id]
      );
      if (zona.rows.length === 0) {
        return next(noEncontrado('Zona no encontrada'));
      }
      zonaId = zona.rows[0].id;
    }

    const token = deviceId ? generarTokenDispositivo() : null;
    const { rows } = await db.query(
      `INSERT INTO contenedores
         (codigo, nombre, zona_id, lat, lng, altura_cm, umbral_ambar, umbral_rojo,
          device_id, token, organizacion_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, codigo, nombre, zona_id, lat, lng, altura_cm, umbral_ambar, umbral_rojo, device_id`,
      [codigo, nombre, zonaId, lat, lng, altura, ambar, rojo, deviceId, token, req.usuario.organizacion_id]
    );
    res.status(201).json({ ...rows[0], token });
  } catch (e) { next(e); }
});

router.post('/inventario', requireAuth, requireRol('superadmin'), async (req, res, next) => {
  try {
    const b = req.body ?? {};
    const codigo = texto(b.codigo, 40);
    const deviceId = texto(b.device_id, 80);
    const altura = num(b.altura_cm);
    const { ambar, rojo, validos } = leerUmbrales(b);

    if (!codigo || !deviceId) {
      return next(validacion('Faltan codigo o device_id'));
    }
    if (!Number.isFinite(altura) || altura <= 0) {
      return next(validacion('altura_cm debe ser mayor que 0'));
    }
    if (!validos) {
      return next(validacion('Umbrales invalidos: enteros de 0 a 100 y umbral_rojo mayor que umbral_ambar'));
    }

    const token = generarTokenDispositivo();
    const codigoVinculacion = generarCodigo();
    const { rows } = await db.query(
      `INSERT INTO contenedores
         (codigo, nombre, altura_cm, umbral_ambar, umbral_rojo, device_id, token, codigo_vinculacion_hash)
       VALUES ($1, 'Sin asignar', $2, $3, $4, $5, $6, $7)
       RETURNING id, codigo, device_id`,
      [codigo, altura, ambar, rojo, deviceId, token, sha256(codigoVinculacion)]
    );
    res.status(201).json({ ...rows[0], token, codigo_vinculacion: codigoVinculacion });
  } catch (e) { next(e); }
});

router.post('/vincular', requireAuth, requireRol('particular', 'admin', 'supervisor', 'operario'), async (req, res, next) => {
  try {
    const b = req.body ?? {};
    const codigoVinculacion = texto(b.codigo_vinculacion, 100);
    const nombre = texto(b.nombre, 120);
    const lat = num(b.lat);
    const lng = num(b.lng);

    if (!codigoVinculacion || !nombre) {
      return next(validacion('Faltan codigo_vinculacion o nombre'));
    }
    if (!coordenadasValidas(lat, lng)) {
      return next(validacion('lat/lng invalidos'));
    }

    let zonaId = null;
    if (b.zona_id !== undefined && b.zona_id !== null) {
      if (!esId(b.zona_id)) {
        return next(validacion('zona_id invalido'));
      }
      const zona = await db.query(
        `SELECT id FROM zonas WHERE id = $1 AND organizacion_id = $2`,
        [b.zona_id, req.usuario.organizacion_id]
      );
      if (zona.rows.length === 0) {
        return next(noEncontrado('Zona no encontrada'));
      }
      zonaId = zona.rows[0].id;
    }

    const { rows } = await db.query(
      `UPDATE contenedores
       SET organizacion_id = $1, nombre = $2, lat = $3, lng = $4, zona_id = $5, codigo_vinculacion_hash = NULL
       WHERE codigo_vinculacion_hash = $6 AND organizacion_id IS NULL AND activo = true
       RETURNING id, codigo, nombre, zona_id, lat, lng`,
      [req.usuario.organizacion_id, nombre, lat, lng, zonaId, sha256(codigoVinculacion)]
    );
    if (rows.length === 0) {
      return next(noEncontrado('Codigo de vinculacion invalido o ya utilizado'));
    }
    res.json(rows[0]);
  } catch (e) { next(e); }
});

router.post('/inventario/lote', requireAuth, requireRol('superadmin'), async (req, res, next) => {
  try {
    const b = req.body ?? {};
    const lista = b.dispositivos;
    if (!Array.isArray(lista) || lista.length === 0 || lista.length > 1000) {
      return next(validacion('dispositivos debe ser una lista de 1 a 1000 elementos'));
    }
    const altura = num(b.altura_cm);
    const { ambar, rojo, validos } = leerUmbrales(b);
    if (!Number.isFinite(altura) || altura <= 0) {
      return next(validacion('altura_cm debe ser mayor que 0'));
    }
    if (!validos) {
      return next(validacion('Umbrales invalidos: enteros de 0 a 100 y umbral_rojo mayor que umbral_ambar'));
    }

    const filas = [];
    const codigos = new Set();
    const dispositivos = new Set();
    for (const [i, d] of lista.entries()) {
      const codigo = texto(d?.codigo, 40);
      const deviceId = texto(d?.device_id, 80);
      if (!codigo || !deviceId) {
        return next(validacion(`dispositivos[${i}]: faltan codigo o device_id`));
      }
      if (codigos.has(codigo) || dispositivos.has(deviceId)) {
        return next(validacion(`dispositivos[${i}]: codigo o device_id repetido en la lista`));
      }
      codigos.add(codigo);
      dispositivos.add(deviceId);
      filas.push({ codigo, deviceId, token: generarTokenDispositivo(), vinculacion: generarCodigo() });
    }

    await db.query(
      `INSERT INTO contenedores (codigo, nombre, altura_cm, umbral_ambar, umbral_rojo, device_id, token, codigo_vinculacion_hash)
       SELECT u.codigo, 'Sin asignar', $1::numeric, $2::smallint, $3::smallint, u.device_id, u.token, u.hash
       FROM unnest($4::text[], $5::text[], $6::text[], $7::text[]) AS u(codigo, device_id, token, hash)`,
      [
        altura, ambar, rojo,
        filas.map((f) => f.codigo),
        filas.map((f) => f.deviceId),
        filas.map((f) => f.token),
        filas.map((f) => sha256(f.vinculacion)),
      ]
    );
    res.status(201).json({
      total: filas.length,
      dispositivos: filas.map((f) => ({
        codigo: f.codigo, device_id: f.deviceId, token: f.token, codigo_vinculacion: f.vinculacion,
      })),
    });
  } catch (e) { next(e); }
});

module.exports = router;
