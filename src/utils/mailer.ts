import nodemailer from 'nodemailer';

// Transporte SMTP configurado por variables de entorno — funciona igual en
// local (con una cuenta Gmail + contraseña de aplicación, por ejemplo) que en
// producción en Render, sin cambiar código, solo las variables de entorno.
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

export async function enviarCorreo(destinatario: string, asunto: string, html: string): Promise<void> {
  if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    throw new Error('El envío de correos no está configurado (faltan variables EMAIL_* en el .env)');
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
