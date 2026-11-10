// Pruebas de integracion de la API. Necesitan una base de datos DESCARTABLE:
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/binova_test  (con db:init y migrate up aplicados)
// Las tablas se vacian al comenzar, por eso solo se aceptan bases locales (o TEST_PERMITIR_REMOTA=1).
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const URL_PRUEBAS = process.env.TEST_DATABASE_URL;
if (!URL_PRUEBAS) {
  console.log('TEST_DATABASE_URL no esta definida: se omiten las pruebas de integracion.');
  process.exit(0);
}
const host = new URL(URL_PRUEBAS).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host) && process.env.TEST_PERMITIR_REMOTA !== '1') {
  console.error(`Por seguridad las pruebas no corren contra ${host} (vacian las tablas).`);
  process.exit(1);
}

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'secreto-de-pruebas';
process.env.DATABASE_URL = URL_PRUEBAS;
if (['localhost', '127.0.0.1', '::1'].includes(host)) process.env.DATABASE_SSL = 'off';
delete process.env.BREVO_API_KEY;
delete process.env.BREVO_FROM_EMAIL;

const bcrypt = require('bcryptjs');
const app = require('../src/app');
const db = require('../src/db');

const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');
let server;
let base;
const enlaces = [];
const warnOriginal = console.warn;

async function api(metodo, ruta, { token, body } = {}) {
  const res = await fetch(base + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch { /* sin cuerpo */ }
  return { status: res.status, data };
}

async function login(correo, clave) {
  const r = await api('POST', '/auth/login', { body: { correo, clave } });
  assert.equal(r.status, 200, `login de ${correo}: ${JSON.stringify(r.data)}`);
  return r.data.token;
}

async function esperarEnlace(patron, desde) {
  for (let i = 0; i < 40; i++) {
    const hallado = enlaces.slice(desde).find((l) => l.includes(patron));
    if (hallado) return new URL(hallado.split('Link:')[1].trim()).searchParams.get('token');
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`No aparecio el enlace ${patron}`);
}

const estado = {};

before(async () => {
  await db.query(`TRUNCATE alertas, recolecciones, incidencias, turnos, lecturas, contenedores, carritos, zonas,
                  invitaciones, recuperaciones_clave, auditoria, usuarios, organizaciones CASCADE`);
  console.warn = (...args) => { enlaces.push(args.join(' ')); };
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
  await db.query(
    `INSERT INTO usuarios (nombre, correo, clave_hash, rol) VALUES ('Super', 'super@binova.test', $1, 'superadmin')`,
    [await bcrypt.hash('ClaveSuper123', 4)]
  );
});

after(async () => {
  console.warn = warnOriginal;
  await new Promise((r) => server.close(r));
  await db.pool.end();
});

describe('salud', () => {
  test('/health y /health/db responden', async () => {
    const h = await (await fetch(base.replace('/api/v1', '/health'))).json();
    assert.equal(h.ok, true);
    const d = await fetch(base.replace('/api/v1', '/health/db'));
    assert.equal(d.status, 200);
    assert.equal((await d.json()).base_de_datos, 'ok');
  });
  test('ruta inexistente devuelve 404 con codigo', async () => {
    const r = await api('GET', '/no-existe');
    assert.equal(r.status, 404);
    assert.equal(r.data.codigo, 'ruta_no_encontrada');
  });
});

describe('cuentas de particulares', () => {
  test('registro, login y /auth/me', async () => {
    const reg = await api('POST', '/auth/registro-particular', { body: { nombre: 'Ana Perez', correo: 'ana@test.com', clave: 'ClaveAna123' } });
    assert.equal(reg.status, 201);
    assert.equal(reg.data.usuario.rol, 'particular');
    estado.tokenA = await login('ana@test.com', 'ClaveAna123');
    const me = await api('GET', '/auth/me', { token: estado.tokenA });
    assert.equal(me.data.organizacion.tipo, 'individual');

    await api('POST', '/auth/registro-particular', { body: { nombre: 'Beto Ruiz', correo: 'beto@test.com', clave: 'ClaveBeto123' } });
    estado.tokenB = await login('beto@test.com', 'ClaveBeto123');
  });
  test('rechaza claves cortas y correos repetidos', async () => {
    const corta = await api('POST', '/auth/registro-particular', { body: { nombre: 'X', correo: 'x@test.com', clave: '123' } });
    assert.equal(corta.status, 400);
    const repetido = await api('POST', '/auth/registro-particular', { body: { nombre: 'Ana 2', correo: 'ANA@test.com', clave: 'OtraClave123' } });
    assert.equal(repetido.status, 409);
    assert.equal(repetido.data.codigo, 'correo_duplicado');
  });
  test('login con clave incorrecta da 401', async () => {
    const r = await api('POST', '/auth/login', { body: { correo: 'ana@test.com', clave: 'incorrecta1' } });
    assert.equal(r.status, 401);
    assert.equal(r.data.codigo, 'credenciales');
  });
  test('PATCH /auth/me cambia el nombre', async () => {
    const r = await api('PATCH', '/auth/me', { token: estado.tokenA, body: { nombre: 'Ana Maria Perez' } });
    assert.equal(r.status, 200);
    assert.equal(r.data.usuario.nombre, 'Ana Maria Perez');
    const vacio = await api('PATCH', '/auth/me', { token: estado.tokenA, body: { nombre: '  ' } });
    assert.equal(vacio.status, 400);
  });
});

describe('recuperacion de clave', () => {
  test('correo desconocido y conocido reciben la misma respuesta', async () => {
    const desconocido = await api('POST', '/auth/olvide-clave', { body: { correo: 'nadie@test.com' } });
    const conocido = await api('POST', '/auth/olvide-clave', { body: { correo: 'ana@test.com' } });
    assert.equal(desconocido.status, 200);
    assert.deepEqual(desconocido.data, conocido.data);
    const n = await db.query(`SELECT count(*)::int AS n FROM recuperaciones_clave`);
    assert.equal(n.rows[0].n, 1);
  });
  test('el enlace restablece la clave una sola vez', async () => {
    const token = await esperarEnlace('Recuperacion', 0);
    const ok = await api('POST', '/auth/restablecer-clave', { body: { token, clave: 'NuevaClaveAna1' } });
    assert.equal(ok.status, 200);
    const vieja = await api('POST', '/auth/login', { body: { correo: 'ana@test.com', clave: 'ClaveAna123' } });
    assert.equal(vieja.status, 401);
    estado.tokenA = await login('ana@test.com', 'NuevaClaveAna1');
    const reuso = await api('POST', '/auth/restablecer-clave', { body: { token, clave: 'OtraMasAna123' } });
    assert.equal(reuso.status, 409);
    assert.equal(reuso.data.codigo, 'enlace_usado');
  });
  test('enlace invalido o vencido se rechaza', async () => {
    const malo = await api('POST', '/auth/restablecer-clave', { body: { token: 'no-existe', clave: 'ClaveValida123' } });
    assert.equal(malo.status, 404);
    assert.equal(malo.data.codigo, 'enlace_invalido');

    const antes = enlaces.length;
    await api('POST', '/auth/olvide-clave', { body: { correo: 'beto@test.com' } });
    const token = await esperarEnlace('Recuperacion', antes);
    await db.query(`UPDATE recuperaciones_clave SET expira_en = now() - interval '1 minute' WHERE token_hash = $1`, [sha256(token)]);
    const vencido = await api('POST', '/auth/restablecer-clave', { body: { token, clave: 'ClaveValida123' } });
    assert.equal(vencido.status, 409);
    assert.equal(vencido.data.codigo, 'enlace_expirado');
  });
  test('el token se guarda solo como hash', async () => {
    const { rows } = await db.query(`SELECT token_hash FROM recuperaciones_clave LIMIT 1`);
    assert.match(rows[0].token_hash, /^[0-9a-f]{64}$/);
  });
});

describe('dispositivos y lecturas', () => {
  test('el inventario guarda el token como hash y no en texto plano', async () => {
    estado.tokenSuper = await login('super@binova.test', 'ClaveSuper123');
    const r = await api('POST', '/contenedores/inventario', { token: estado.tokenSuper, body: { codigo: 'T-001', device_id: 'DEV-1', altura_cm: 100 } });
    assert.equal(r.status, 201);
    assert.match(r.data.token, /^tk_[0-9a-f]{48}$/);
    estado.dev = r.data;
    const { rows } = await db.query(`SELECT token, token_hash FROM contenedores WHERE device_id = 'DEV-1'`);
    assert.equal(rows[0].token, null);
    assert.equal(rows[0].token_hash, sha256(r.data.token));
  });
  test('lecturas: token ausente o incorrecto da 401', async () => {
    const cuerpo = { device_id: 'DEV-1', distancia_cm: 20 };
    assert.equal((await api('POST', '/lecturas', { body: cuerpo })).status, 401);
    assert.equal((await api('POST', '/lecturas', { token: 'tk_incorrecto', body: cuerpo })).status, 401);
    assert.equal((await api('POST', '/lecturas', { token: estado.dev.token, body: { device_id: 'NO-EXISTE', distancia_cm: 1 } })).status, 404);
    assert.equal((await api('POST', '/lecturas', { token: estado.dev.token, body: { device_id: 'DEV-1', distancia_cm: -5 } })).status, 400);
  });
  test('una lectura alta abre la alerta y una baja la cierra', async () => {
    const alta = await api('POST', '/lecturas', { token: estado.dev.token, body: { device_id: 'DEV-1', distancia_cm: 10, bateria: 90 } });
    assert.equal(alta.status, 200);
    assert.equal(alta.data.nivel, 90);
    assert.equal(alta.data.estado, 'rojo');
    let a = await db.query(`SELECT count(*)::int AS n FROM alertas WHERE tipo = 'llenado_critico' AND atendida_en IS NULL`);
    assert.equal(a.rows[0].n, 1);
    await api('POST', '/lecturas', { token: estado.dev.token, body: { device_id: 'DEV-1', distancia_cm: 10 } });
    a = await db.query(`SELECT count(*)::int AS n FROM alertas WHERE tipo = 'llenado_critico' AND atendida_en IS NULL`);
    assert.equal(a.rows[0].n, 1, 'no se duplica la alerta pendiente');
    const baja = await api('POST', '/lecturas', { token: estado.dev.token, body: { device_id: 'DEV-1', distancia_cm: 90 } });
    assert.equal(baja.data.estado, 'verde');
    a = await db.query(`SELECT count(*)::int AS n FROM alertas WHERE tipo = 'llenado_critico' AND atendida_en IS NULL`);
    assert.equal(a.rows[0].n, 0);
  });
  test('tokens antiguos en texto plano siguen funcionando durante la migracion', async () => {
    await db.query(`UPDATE contenedores SET token = 'tk_antiguo', token_hash = NULL WHERE device_id = 'DEV-1'`);
    assert.equal((await api('POST', '/lecturas', { token: 'tk_antiguo', body: { device_id: 'DEV-1', distancia_cm: 50 } })).status, 200);
    assert.equal((await api('POST', '/lecturas', { token: 'tk_otro', body: { device_id: 'DEV-1', distancia_cm: 50 } })).status, 401);
    await db.query(`UPDATE contenedores SET token = NULL, token_hash = $1 WHERE device_id = 'DEV-1'`, [sha256(estado.dev.token)]);
  });
});

describe('vinculacion y aislamiento entre cuentas', () => {
  test('el particular vincula con el codigo, que solo sirve una vez', async () => {
    const r = await api('POST', '/contenedores/vincular', { token: estado.tokenA, body: { codigo_vinculacion: estado.dev.codigo_vinculacion, nombre: 'Mi tacho', lat: -8.11, lng: -79.02 } });
    assert.equal(r.status, 200);
    estado.contenedorId = r.data.id;
    const otra = await api('POST', '/contenedores/vincular', { token: estado.tokenB, body: { codigo_vinculacion: estado.dev.codigo_vinculacion, nombre: 'Robado', lat: -8.1, lng: -79 } });
    assert.equal(otra.status, 404);
  });
  test('cada cuenta solo ve sus contenedores', async () => {
    const a = await api('GET', '/contenedores', { token: estado.tokenA });
    assert.equal(a.data.length, 1);
    const b = await api('GET', '/contenedores', { token: estado.tokenB });
    assert.equal(b.data.length, 0);
    assert.equal((await api('GET', `/contenedores/${estado.contenedorId}`, { token: estado.tokenB })).status, 404);
  });
  test('el particular edita nombre y ubicacion, no la configuracion', async () => {
    const ok = await api('PATCH', `/contenedores/${estado.contenedorId}`, { token: estado.tokenA, body: { nombre: 'Tacho de la cocina' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.nombre, 'Tacho de la cocina');
    const no = await api('PATCH', `/contenedores/${estado.contenedorId}`, { token: estado.tokenA, body: { altura_cm: 5 } });
    assert.equal(no.status, 403);
    const ajeno = await api('PATCH', `/contenedores/${estado.contenedorId}`, { token: estado.tokenB, body: { nombre: 'Mio' } });
    assert.equal(ajeno.status, 404);
  });
  test('desvincular deja el tacho libre con un codigo nuevo', async () => {
    const r = await api('POST', `/contenedores/${estado.contenedorId}/desvincular`, { token: estado.tokenA });
    assert.equal(r.status, 200);
    assert.ok(r.data.codigo_vinculacion);
    assert.equal((await api('GET', '/contenedores', { token: estado.tokenA })).data.length, 0);
    const vieja = await api('POST', '/contenedores/vincular', { token: estado.tokenB, body: { codigo_vinculacion: estado.dev.codigo_vinculacion, nombre: 'X', lat: 1, lng: 1 } });
    assert.equal(vieja.status, 404);
    const nueva = await api('POST', '/contenedores/vincular', { token: estado.tokenB, body: { codigo_vinculacion: r.data.codigo_vinculacion, nombre: 'Tacho de Beto', lat: -8.1, lng: -79 } });
    assert.equal(nueva.status, 200);
    assert.equal((await api('POST', `/contenedores/${estado.contenedorId}/desvincular`, { token: estado.tokenA })).status, 404);
  });
});

describe('empresas, invitaciones y roles', () => {
  test('solicitud, aprobacion y activacion de la cuenta del admin', async () => {
    const sol = await api('POST', '/organizaciones/solicitud', { body: { nombre: 'Colegio Demo', contacto_nombre: 'Luz Vega', contacto_correo: 'luz@colegio.test' } });
    assert.equal(sol.status, 201);
    const lista = await api('GET', '/organizaciones?estado=pendiente', { token: estado.tokenSuper });
    assert.equal(lista.data.length, 1);
    const antes = enlaces.length;
    const ap = await api('POST', `/organizaciones/${lista.data[0].id}/aprobar`, { token: estado.tokenSuper });
    assert.equal(ap.status, 201);
    estado.orgId = ap.data.organizacion.id;
    const token = await esperarEnlace('Invitacion', antes);
    assert.equal((await api('GET', `/auth/invitacion?token=${token}`)).status, 200);
    const sinClave = await api('POST', '/auth/login', { body: { correo: 'luz@colegio.test', clave: 'loquesea123' } });
    assert.notEqual(sinClave.status, 200);
    assert.equal((await api('POST', '/auth/activar-invitacion', { body: { token, clave: 'ClaveLuz1234' } })).status, 200);
    estado.tokenAdmin = await login('luz@colegio.test', 'ClaveLuz1234');
  });
  test('el admin crea un operario y los roles se respetan', async () => {
    const nuevo = await api('POST', '/usuarios', { token: estado.tokenAdmin, body: { nombre: 'Omar Diaz', correo: 'omar@colegio.test', rol: 'operario' } });
    assert.equal(nuevo.status, 201);
    assert.ok(nuevo.data.clave_temporal);
    estado.tokenOperario = await login('omar@colegio.test', nuevo.data.clave_temporal);
    assert.equal((await api('POST', '/usuarios', { token: estado.tokenOperario, body: { nombre: 'Z', correo: 'z@colegio.test', rol: 'operario' } })).status, 403);
    assert.equal((await api('GET', '/organizaciones', { token: estado.tokenAdmin })).status, 403);
    assert.equal((await api('GET', '/organizaciones', { token: estado.tokenSuper })).status, 200);
  });
  test('una organizacion suspendida pierde el acceso', async () => {
    const r = await api('PATCH', `/organizaciones/${estado.orgId}/estado`, { token: estado.tokenSuper, body: { estado: 'suspendida' } });
    assert.equal(r.status, 200);
    const bloqueado = await api('GET', '/usuarios', { token: estado.tokenAdmin });
    assert.equal(bloqueado.status, 403);
    assert.equal(bloqueado.data.codigo, 'org_inactiva');
    await api('PATCH', `/organizaciones/${estado.orgId}/estado`, { token: estado.tokenSuper, body: { estado: 'activa' } });
    assert.equal((await api('GET', '/usuarios', { token: estado.tokenAdmin })).status, 200);
  });
});

describe('paginacion y auditoria', () => {
  test('limite y desde se validan', async () => {
    assert.equal((await api('GET', '/contenedores?limite=0', { token: estado.tokenB })).status, 400);
    assert.equal((await api('GET', '/contenedores?limite=abc', { token: estado.tokenB })).status, 400);
    assert.equal((await api('GET', '/contenedores?desde=-1', { token: estado.tokenB })).status, 400);
    assert.equal((await api('GET', '/contenedores?limite=1&desde=0', { token: estado.tokenB })).status, 200);
    assert.equal((await api('GET', '/usuarios?limite=1', { token: estado.tokenAdmin })).data.length, 1);
  });
  test('la auditoria registra las acciones sensibles', async () => {
    const s = await api('GET', '/auditoria?accion=organizacion_aprobada', { token: estado.tokenSuper });
    assert.equal(s.status, 200);
    assert.equal(s.data.length, 1);
    const propia = await api('GET', '/auditoria', { token: estado.tokenAdmin });
    assert.equal(propia.status, 200);
    assert.ok(propia.data.every((x) => String(x.organizacion_id) === String(estado.orgId)));
    assert.ok(propia.data.some((x) => x.accion === 'usuario_creado'));
    assert.equal((await api('GET', '/auditoria', { token: estado.tokenOperario })).status, 403);
    assert.equal((await api('GET', '/auditoria')).status, 401);
  });
});

describe('mantenimiento', () => {
  test('purga lecturas viejas y genera alertas de sin reporte', async () => {
    const dev = await db.query(`SELECT id FROM contenedores WHERE device_id = 'DEV-1'`);
    const id = dev.rows[0].id;
    await db.query(`INSERT INTO lecturas (contenedor_id, distancia_cm, nivel, medido_en) VALUES ($1, 50, 50, now() - interval '400 days')`, [id]);
    await db.query(`UPDATE contenedores SET ultima_lectura_en = now() - interval '3 hours', organizacion_id = $2 WHERE id = $1`, [id, estado.orgId]);
    const salida = execFileSync(process.execPath, [path.join(__dirname, '..', 'tools', 'mantenimiento.js')], {
      env: { ...process.env, DATABASE_URL: URL_PRUEBAS }, encoding: 'utf8',
    });
    const resumen = JSON.parse(salida.trim().split('\n').pop()).mantenimiento;
    assert.ok(resumen.lecturas_borradas >= 1);
    assert.equal(resumen.alertas_sin_reporte_nuevas, 1);
    const vieja = await db.query(`SELECT count(*)::int AS n FROM lecturas WHERE medido_en < now() - interval '300 days'`);
    assert.equal(vieja.rows[0].n, 0);
  });
});
