import nodemailer from 'nodemailer';

// Dos formas de enviar correo, elegidas automáticamente según las variables
// de entorno:
//
// 1. RESEND_API_KEY presente -> se usa la API HTTP de Resend (puerto 443).
//    Es la que se usa en Render: los hostings gratuitos suelen bloquear las
//    conexiones SMTP salientes (puerto 587/465) para evitar spam, así que el
//    envío por SMTP se queda colgado ahí hasta fallar por timeout. HTTP nunca
//    tiene ese problema.
// 2. Si no, se usa SMTP normal (nodemailer) con las variables EMAIL_* — es lo
//    que se usa en desarrollo local con Gmail, donde SMTP sí funciona bien.
type Transporter = ReturnType<typeof nodemailer.createTransport>;

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: Number(process.env.EMAIL_PORT || 587),
    secure: process.env.EMAIL_SECURE === 'true',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  return transporter;
}

async function enviarPorResend(destinatario: string, asunto: string, html: string): Promise<void> {
  const respuesta = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || 'onboarding@resend.dev',
      to: destinatario,
      subject: asunto,
      html,
    }),
  });

  if (!respuesta.ok) {
    const detalle = await respuesta.text();
    throw new Error(`Resend respondió ${respuesta.status}: ${detalle}`);
  }
}

export async function enviarCorreo(destinatario: string, asunto: string, html: string): Promise<void> {
  if (process.env.RESEND_API_KEY) {
    await enviarPorResend(destinatario, asunto, html);
    return;
  }

  if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    throw new Error('El envío de correos no está configurado (faltan RESEND_API_KEY o las variables EMAIL_* en el .env)');
  }

  await getTransporter().sendMail({
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to: destinatario,
    subject: asunto,
    html,
  });
}

export function plantillaCodigoRecuperacion(nombre: string, codigo: string): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #1f2937;">
      <h2 style="color: #A000D1; margin-bottom: 4px;">SisMedy</h2>
      <p>Hola ${nombre},</p>
      <p>Recibimos una solicitud para restablecer tu contraseña. Usa este código para continuar:</p>
      <div style="font-size: 32px; font-weight: 700; letter-spacing: 8px; background: #f5f3ff; color: #7c3aed; padding: 16px; border-radius: 12px; text-align: center; margin: 20px 0;">
        ${codigo}
      </div>
      <p style="font-size: 13px; color: #6b7280;">Este código vence en 10 minutos. Si no solicitaste este cambio, puedes ignorar este correo.</p>
    </div>
  `;
}
