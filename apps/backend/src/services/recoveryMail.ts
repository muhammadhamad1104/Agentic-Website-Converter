import Joi from 'joi';
import nodemailer from 'nodemailer';

export function recoveryConfiguration() {
  const host = process.env.SMTP_HOST;
  const from = process.env.SMTP_FROM;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !from || !process.env.FRONTEND_URL || Joi.string().email().validate(from).error || Boolean(user) !== Boolean(pass)) return null;
  try {
    const origin = new URL(process.env.FRONTEND_URL);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
    if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/' || (origin.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && local && origin.protocol === 'http:'))) return null;
    const port = Number(process.env.SMTP_PORT || 587);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    const secure = process.env.SMTP_SECURE === 'true' || port === 465;
    const allowLocal = process.env.NODE_ENV !== 'production' && process.env.SMTP_ALLOW_INSECURE_LOCAL === 'true' && ['localhost', '127.0.0.1', 'mailpit'].includes(host);
    return { origin: origin.origin, from, transport: {
      host, port, secure, requireTLS: !secure && !allowLocal,
      ...(user && pass ? { auth: { user, pass } } : {}),
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
      logger: false, debug: false,
    } };
  } catch { return null; }
}

export function supportEmail() {
  const email = process.env.SUPPORT_EMAIL;
  return email && !Joi.string().email().validate(email).error ? email : null;
}

export async function sendRecoveryEmail(email: string, token: string) {
  const config = recoveryConfiguration();
  if (!config) throw new Error('Email recovery is not configured');
  const url = new URL('/reset-password', config.origin);
  // Fragments are not sent to HTTP servers or included in Referer headers.
  url.hash = new URLSearchParams({ token }).toString();
  await nodemailer.createTransport(config.transport).sendMail({
    from: config.from, to: email, subject: 'Reset your Agentic Converter password',
    text: `A password reset was requested for your Agentic Converter account.\n\nOpen this link to choose a new password:\n${url.href}\n\nThis link expires in 15 minutes and can be used only once. If you did not request it, ignore this email. Your password has not changed.\nNever share this link or your password with anyone.`,
    disableFileAccess: true, disableUrlAccess: true,
  });
}

export async function sendPasswordChangedEmail(email: string) {
  const config = recoveryConfiguration();
  if (!config) return;
  await nodemailer.createTransport(config.transport).sendMail({
    from: config.from, to: email, subject: 'Your Agentic Converter password changed',
    text: `Your Agentic Converter password was changed. Previous sign-in sessions and password-reset links have been revoked.\n\nIf this was not you, request a new recovery link at ${config.origin}/forgot-password${supportEmail() ? ` or contact ${supportEmail()}` : ''}.\nNever share passwords or recovery links.`,
    disableFileAccess: true, disableUrlAccess: true,
  });
}
