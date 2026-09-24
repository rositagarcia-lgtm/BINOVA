function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function urlApp() {
  const app = (process.env.APP_URL || '').trim().replace(/\/$/, '');
  if (app) return app;
  const cors = (process.env.CORS_ORIGINS || '').split(',')[0].trim().replace(/\/$/, '');
  return cors || 'http://localhost:5173';
}

function envoltorio(titulo, cuerpo) {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><title>${titulo}</title></head>
<body style="margin:0;background:#f4f4f5;font-family:Segoe UI,Arial,sans-serif;color:#1a1a1a;">
  <div style="max-width:560px;margin:32px auto;background:#fff;padding:32px 28px;border:1px solid #e5e5e5;">
    <p style="margin:0 0 4px;font-size:12px;letter-spacing:.08em;color:#666;">BINOVA</p>
    <h1 style="margin:0 0 20px;font-size:20px;">${titulo}</h1>
    ${cuerpo}
    <p style="margin:28px 0 0;font-size:12px;color:#888;">Si no esperabas este mensaje, puedes ignorarlo.</p>
  </div>
</body>
</html>`;
}

async function enviar({ para, nombrePara, asunto, html }) {
  const key = process.env.BREVO_API_KEY;
  const fromEmail = process.env.BREVO_FROM_EMAIL;
  const fromName = process.env.BREVO_FROM_NAME || 'BINOVA';
  if (!key || !fromEmail) {
    console.warn('Correo no enviado (faltan BREVO_API_KEY o BREVO_FROM_EMAIL):', asunto, '->', para);
    return false;
  }

  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': key,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender: { email: fromEmail, name: fromName },
        to: [{ email: para, name: nombrePara || para }],
        subject: asunto,
        htmlContent: html,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.error('Brevo', res.status, await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error('Brevo:', e.message);
    return false;
  }
}

function enviarSolicitudRecibida({ nombre, correo, organizacion }) {
  const html = envoltorio(
    'Recibimos tu solicitud',
    `<p>Hola ${esc(nombre)},</p>
     <p>Recibimos la solicitud de <strong>${esc(organizacion)}</strong> para usar BINOVA.</p>
     <p>Pronto recibirás una respuesta. Si la aprobamos, te enviaremos un enlace para crear tus credenciales.</p>`,
  );
  return enviar({
    para: correo,
    nombrePara: nombre,
    asunto: 'Recibimos tu solicitud en BINOVA',
    html,
  });
}

function enviarAccesoListo({ nombre, correo, link }) {
  const html = envoltorio(
    'Tu acceso está listo',
    `<p>Hola ${esc(nombre)},</p>
     <p>Aprobamos tu organización en BINOVA. Crea tu clave con este enlace (válido 72 horas):</p>
     <p style="margin:24px 0;">
       <a href="${esc(link)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 16px;">Crear mis credenciales</a>
     </p>
     <p style="font-size:12px;color:#666;word-break:break-all;">Si el botón no funciona, copia este enlace:<br>${esc(link)}</p>
     <p>Después entra con tu correo y la clave que elijas.</p>`,
  );
  return enviar({
    para: correo,
    nombrePara: nombre,
    asunto: 'Tu acceso a BINOVA está listo — crea tu clave',
    html,
  });
}

function linkActivacion(token) {
  return `${urlApp()}/activar?token=${encodeURIComponent(token)}`;
}

module.exports = {
  enviarSolicitudRecibida,
  enviarAccesoListo,
  linkActivacion,
  urlApp,
};
