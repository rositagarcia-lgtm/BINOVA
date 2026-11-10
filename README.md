# BINOVA API

API REST de BINOVA (monitoreo IoT de contenedores de residuos). Express 5 + PostgreSQL (Supabase), JWT, multi-organización.

- Base: `https://binova-api.onrender.com/api/v1` (salud: `/health`, `/health/db`)
- Roles: `superadmin`, `admin`, `supervisor`, `operario`, `particular`
- Los errores responden `{ "error": "mensaje", "codigo": "codigo_estable" }`

## Variables de entorno

| Variable | Obligatoria | Descripción |
|---|---|---|
| `DATABASE_URL` | sí | Cadena de conexión de Postgres |
| `JWT_SECRET` | sí | Secreto para firmar los JWT (12 h) |
| `CORS_ORIGINS` | sí en producción | Orígenes permitidos, separados por coma |
| `APP_URL` | recomendada | URL del panel web (enlaces de los correos) |
| `BREVO_API_KEY`, `BREVO_FROM_EMAIL`, `BREVO_FROM_NAME` | para correos | Envío de invitaciones, bienvenida, recuperación y avisos |
| `MAPBOX_TOKEN` | opcional | Matriz de distancias para la ruta óptima (si falta usa distancia en línea recta) |
| `DATABASE_CA` | opcional | Certificado CA de Supabase (PEM o ruta). Con él la conexión se verifica; sin él se acepta cualquier certificado |
| `DATABASE_SSL=off` | solo local | Postgres local sin SSL |
| `DATABASE_POOL_MAX` | opcional | Conexiones máximas (por defecto 5) |
| `RETENCION_LECTURAS_DIAS` | opcional | Días que se conservan las lecturas (por defecto 180) |
| `PORT`, `NODE_ENV` | opcional | |

## Desarrollo

```bash
npm install
cp .env.example .env      # y completa los valores
npm run dev
```

## Base de datos

| Comando | Qué hace |
|---|---|
| `npm run db:init` | Base **nueva y vacía**: carga `db/schema.sql` (esquema base) y marca las migraciones base como aplicadas |
| `npm run migrate up` | Aplica las migraciones pendientes (`migrations/`) |
| `npm run migrate down` | Revierte la última migración |
| `npm run db:snapshot` | Regenera `db/schema.sql` desde la base conectada (solo lectura) |
| `npm run respaldo` | Guarda todas las tablas en un JSON (carpeta `../backups` o `BACKUP_DIR`). `-- --sin-secretos` omite hashes y tokens. **No lo subas a Git** |
| `db/rol-aplicacion.sql` | Opcional: rol `binova_app` con permisos mínimos para la API (ver abajo) |

Crear una base desde cero: `npm run db:init && npm run migrate up`.

**Orden al desplegar cambios de base de datos:** primero `npm run migrate up`, después desplegar el código.

### Rol con permisos mínimos (recomendado)
La API puede conectarse con un rol que no sea `postgres`. Ejecuta `db/rol-aplicacion.sql` en Supabase (cambiando la clave) y usa ese rol en `DATABASE_URL` (usuario `binova_app.<ref-del-proyecto>`). Las migraciones siguen usando `postgres`. Si agregas una tabla nueva, vuelve a ejecutar el archivo.

### Tokens de dispositivo
El token de cada ESP32 se guarda como hash (`contenedores.token_hash`); el valor en claro solo se muestra una vez al crear o regenerar. Durante la transición aún existe la columna `token`; cuando los dispositivos funcionen con la API nueva ejecuta `db/pendientes/quitar-token-plano.sql`.

## Pruebas

```bash
# base de datos descartable (db:init + migrate up aplicados)
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/binova_test DATABASE_SSL=off npm test
```
Las pruebas **vacían las tablas**: solo aceptan bases locales (o `TEST_PERMITIR_REMOTA=1`). GitHub Actions las ejecuta en cada push (`.github/workflows/ci.yml`).

## Tareas programadas

`npm run mantenimiento` (genera alertas "sin reporte", borra lecturas antiguas, limpia enlaces vencidos). Opciones:
- **GitHub Actions** (gratis): `.github/workflows/mantenimiento.yml`. Agrega los secretos `DATABASE_URL` y `API_URL`. Además consulta `/health/db` cada 10 min, lo que mantiene despierta la API de Render y evita que Supabase se pause.
- **Render Cron Job** (de pago): comando `npm run mantenimiento`.

## Endpoints

### Autenticación — `/auth`
| Método | Ruta | Quién | Qué hace |
|---|---|---|---|
| POST | `/login` | público | JWT de 12 h |
| POST | `/registro-particular` | público | Crea cuenta de particular y envía bienvenida |
| POST | `/olvide-clave` | público | Envía enlace de recuperación (misma respuesta exista o no el correo) |
| POST | `/restablecer-clave` | público | `{ token, clave }`: fija la nueva clave (enlace de 1 h, un solo uso) |
| GET | `/invitacion?token=` | público | Datos de una invitación |
| POST | `/activar-invitacion` | público | `{ token, clave }` |
| GET / PATCH | `/me` | cualquiera | Perfil; PATCH cambia el nombre |
| POST | `/cambiar-clave` | cualquiera | `{ clave_actual, clave_nueva }` |

### Organizaciones — `/organizaciones`
`POST /solicitud` (público) · `GET /`, `GET /:id/usuarios`, `POST /:id/aprobar`, `PATCH /:id/estado`, `POST /:id/reenviar-invitacion` (superadmin)

### Usuarios — `/usuarios`
`GET /` (admin, supervisor) · `POST /`, `PATCH /:id` (admin) · `POST /:id/restablecer-clave` (admin, superadmin)

### Contenedores — `/contenedores`
| Método | Ruta | Quién |
|---|---|---|
| GET | `/`, `/:id`, `/:id/historico` | admin, supervisor, operario, particular (solo su organización) |
| POST | `/` | admin |
| PATCH | `/:id` | admin (todo) · particular (solo `nombre`, `lat`, `lng`) |
| POST | `/vincular` | particular, admin, supervisor, operario |
| POST | `/:id/desvincular` | admin, particular (devuelve un código de vinculación nuevo) |
| POST | `/inventario`, `/inventario/lote` | superadmin |

### Lecturas — `POST /lecturas`
Cabecera `Authorization: Bearer <token del dispositivo>`; cuerpo `{ device_id, distancia_cm, bateria?, rssi? }`. Responde `{ ok, nivel, estado, intervalo_seg }`.

### Operación en campo
`/zonas`, `/carritos`, `/turnos`, `/alertas` (`tomar`, `soltar`, `asignar`, `atender`), `/recolecciones`, `/incidencias`, `/estadisticas` (`resumen`, `recolecciones-por-dia`), `/rutas/optima`. Los permisos de cada ruta están en `src/routes/`.

### Auditoría — `GET /auditoria`
admin (su organización) y superadmin (todas, `?organizacion_id=`). Filtros `?accion=`, paginación `?limite=&desde=`.

### Paginación
Los listados aceptan `?limite=` (máximo 1000) y `?desde=`.

## Avisos por correo
Cuando un contenedor pasa a rojo se envía un correo a los admin, supervisores y particulares de su organización (una vez por alerta nueva).
