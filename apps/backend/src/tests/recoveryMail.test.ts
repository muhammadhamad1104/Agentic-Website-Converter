import nodemailer from 'nodemailer';
import { recoveryConfiguration, sendRecoveryEmail, supportEmail } from '../services/recoveryMail';

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));
const saved = { ...process.env };
const send = jest.fn().mockResolvedValue({});
beforeEach(() => {
  process.env = { ...saved, NODE_ENV: 'production', FRONTEND_URL: 'https://converter.example.com', SMTP_HOST: 'smtp.example.com', SMTP_FROM: 'noreply@example.com', SMTP_PORT: '587', SMTP_USER: 'mailer', SMTP_PASS: 'test-provider-password' };
  delete process.env.SMTP_SECURE; delete process.env.SMTP_ALLOW_INSECURE_LOCAL; delete process.env.SUPPORT_EMAIL;
  jest.clearAllMocks(); (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail: send });
});
afterEach(() => { process.env = { ...saved }; });
test('requires STARTTLS and keeps SMTP debugging disabled', () => {
  expect(recoveryConfiguration()?.transport).toMatchObject({ secure: false, requireTLS: true, debug: false, logger: false });
});
test('uses immediate TLS for port 465', () => {
  process.env.SMTP_PORT = '465'; expect(recoveryConfiguration()?.transport.secure).toBe(true);
});
test.each(['http://converter.example.com', 'https://attacker:password@converter.example.com', 'https://converter.example.com/?redirect=attacker', 'https://converter.example.com/#bad'])('rejects unsafe reset origin %s', origin => {
  process.env.FRONTEND_URL = origin; expect(recoveryConfiguration()).toBeNull();
});
test('disables recovery when SMTP credentials are incomplete', () => {
  delete process.env.SMTP_PASS; expect(recoveryConfiguration()).toBeNull();
});
test('never allows plaintext SMTP in production, even if explicitly requested', () => {
  process.env.SMTP_HOST = 'localhost'; process.env.SMTP_ALLOW_INSECURE_LOCAL = 'true';
  expect(recoveryConfiguration()?.transport.requireTLS).toBe(true);
});
test('permits a deliberately configured local development email sink', () => {
  process.env.NODE_ENV = 'development'; process.env.FRONTEND_URL = 'http://localhost:5173'; process.env.SMTP_HOST = 'localhost'; process.env.SMTP_ALLOW_INSECURE_LOCAL = 'true';
  expect(recoveryConfiguration()?.transport.requireTLS).toBe(false);
});
test('uses the trusted origin and a fragment token without fetching remote attachments', async () => {
  await sendRecoveryEmail('owner@example.com', 'a'.repeat(64));
  const message = send.mock.calls[0][0];
  expect(message.to).toBe('owner@example.com');
  expect(message.text).toContain('https://converter.example.com/reset-password#token=' + 'a'.repeat(64));
  expect(message.text).not.toContain('?token='); expect(message.disableFileAccess).toBe(true); expect(message.disableUrlAccess).toBe(true);
});
test('does not invent support addresses and rejects malformed ones', () => {
  expect(supportEmail()).toBeNull(); process.env.SUPPORT_EMAIL = 'support@example.com'; expect(supportEmail()).toBe('support@example.com');
  process.env.SUPPORT_EMAIL = 'support@example.com\r\nBcc: attacker@example.com'; expect(supportEmail()).toBeNull();
});
