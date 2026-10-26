import { MailDeliveryError, type MailMessage } from '../../mail/mail-transport';
import { PASSWORD_RESET_TTL_MINUTES } from './password-reset.limits';

/**
 * Correo de recuperacion de contrasena -- contenido definitivo.
 *
 * Es un mensaje transaccional SENSIBLE: lleva un enlace que da acceso a una cuenta.
 * Por eso es deliberadamente sobrio: sin imagenes, sin logotipos remotos, sin
 * contenido promocional, sin datos personales en el cuerpo.
 *
 * NO LLEVA NINGUNA SENAL DE SEGUIMIENTO. Ni pixeles, ni imagenes remotas, ni
 * parametros de campana en el enlace, ni hojas de estilo externas. Hay un limite
 * honesto sobre lo que este archivo puede garantizar: el seguimiento de aperturas y de
 * clics de Resend se activa POR DOMINIO (no por mensaje) y, si estuviera activo, el
 * proveedor reescribiria los enlaces del HTML hacia su propio subdominio. Eso no se
 * puede desactivar desde el codigo; se verifica en el panel del dominio (ver el
 * reporte y `.env.example`). Esta plantilla evita todo lo que SI esta en su mano.
 *
 * El enlace es EXACTAMENTE el que construyo el backend (`buildPasswordResetLink`) y
 * aparece tal cual en cuatro lugares: el boton y el enlace alternativo del HTML, y el
 * texto plano. Conserva el fragmento (`#token=...`): ninguno de esos lugares lo
 * recodifica ni lo altera.
 *
 * Idioma: espanol rioplatense, voseo, como el resto del producto.
 */

export const PASSWORD_RESET_SUBJECT = 'Restablecé tu contraseña de Scope';
export const PASSWORD_RESET_CTA_LABEL = 'Restablecer contraseña';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * El enlace ya viene de configuracion validada + un token base64url, asi que no
 * deberia poder fallar. Si fallara (un bug aguas arriba), el mensaje NO sale: es un
 * `not_sent` determinista, no un envio con un enlace roto o inyectable.
 */
function assertSafeLink(link: string): void {
  if (!/^https?:\/\/[^\s"'<>\\]+$/.test(link)) {
    throw new MailDeliveryError('not_sent', 'recovery link is not a plain http(s) URL');
  }
}

const FONT_STACK =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export function buildPasswordResetEmail(input: {
  to: string;
  link: string;
  /** Ver `MailMessage.idempotencyKey`: opaca y estable por autorizacion. */
  idempotencyKey?: string;
}): MailMessage {
  assertSafeLink(input.link);

  const minutes = PASSWORD_RESET_TTL_MINUTES;
  const link = input.link;
  const safeLink = escapeHtml(link);

  const lead =
    'Recibimos una solicitud para recuperar el acceso a tu cuenta de Scope. Con este enlace podés elegir una contraseña nueva.';
  const expiry = `El enlace vence en ${minutes} minutos y se puede usar una sola vez. Si pediste más de uno, solo funciona el último.`;
  const ignore =
    'Si no pediste este cambio, podés ignorar este correo. Ignorarlo no modifica tu contraseña actual: sigue funcionando igual.';

  const text = [
    PASSWORD_RESET_SUBJECT,
    '',
    lead,
    '',
    `${PASSWORD_RESET_CTA_LABEL}:`,
    link,
    '',
    expiry,
    '',
    ignore
  ].join('\n');

  const paragraph = `margin:0 0 16px;font-family:${FONT_STACK};font-size:16px;line-height:24px;color:#1f2933;`;

  const html = [
    '<!doctype html>',
    '<html lang="es">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(PASSWORD_RESET_SUBJECT)}</title>`,
    '</head>',
    '<body style="margin:0;padding:0;background-color:#f4f6f8;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f6f8;">',
    '<tr><td align="center" style="padding:24px 12px;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background-color:#ffffff;border-radius:8px;">',
    '<tr><td style="padding:32px 28px;">',
    `<p style="margin:0 0 4px;font-family:${FONT_STACK};font-size:13px;line-height:18px;letter-spacing:2px;font-weight:600;color:#0f766e;">SCOPE</p>`,
    `<h1 style="margin:0 0 16px;font-family:${FONT_STACK};font-size:22px;line-height:28px;font-weight:700;color:#1f2933;">Restablecé tu contraseña</h1>`,
    `<p style="${paragraph}">${escapeHtml(lead)}</p>`,
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">',
    `<tr><td align="center" style="border-radius:6px;background-color:#0f766e;"><a href="${safeLink}" style="display:inline-block;padding:12px 24px;font-family:${FONT_STACK};font-size:16px;line-height:24px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">${escapeHtml(PASSWORD_RESET_CTA_LABEL)}</a></td></tr>`,
    '</table>',
    `<p style="${paragraph}">${escapeHtml(expiry)}</p>`,
    `<p style="${paragraph}">Si el botón no funciona, copiá y pegá este enlace en tu navegador:</p>`,
    `<p style="margin:0 0 16px;font-family:${FONT_STACK};font-size:14px;line-height:20px;word-break:break-all;"><a href="${safeLink}" style="color:#0f766e;">${safeLink}</a></p>`,
    `<p style="${paragraph}">${escapeHtml(ignore)}</p>`,
    '</td></tr>',
    '</table>',
    '</td></tr>',
    '</table>',
    '</body>',
    '</html>'
  ].join('\n');

  return {
    to: input.to,
    subject: PASSWORD_RESET_SUBJECT,
    text,
    html,
    ...(input.idempotencyKey !== undefined ? { idempotencyKey: input.idempotencyKey } : {})
  };
}
