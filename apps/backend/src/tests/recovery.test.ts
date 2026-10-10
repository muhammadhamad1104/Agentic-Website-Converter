import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';
import authRoutes from '../routes/auth';
import { enqueueRecovery, enqueuePasswordChanged } from '../queue/passwordRecoveryQueue';
import { sendRecoveryEmail } from '../services/recoveryMail';
import { issuePasswordRecovery, resetTokenHash } from '../services/passwordRecovery';

jest.mock('../queue/passwordRecoveryQueue', () => ({ enqueueRecovery: jest.fn(), enqueuePasswordChanged: jest.fn() }));
jest.mock('../services/recoveryMail', () => ({ recoveryConfiguration: jest.fn(() => ({})), supportEmail: jest.fn(() => null), sendRecoveryEmail: jest.fn() }));
jest.mock('../middleware/rateLimiter', () => ({ rateLimiter: (_req: any, _res: any, next: any) => next(), recoveryRateLimiter: (_req: any, _res: any, next: any) => next() }));
jest.mock('@prisma/client', () => ({ PrismaClient: jest.fn(() => ({ user: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() } })) }));
const db = new PrismaClient() as any;
// Share one mock across the controller, service, and middleware clients.
const clients = (PrismaClient as unknown as jest.Mock).mock.results.map(result => result.value);
const app = express(); app.use(express.json()); app.use('/auth', authRoutes);
process.env.JWT_SECRET = 'recovery-test-secret';
let hash: string;
let user: any;
const rawToken = 'a'.repeat(64);
const newPassword = 'A brand new password 2026';
const reset = (body: any = {}) => request(app).post('/auth/reset-password').send({ token: rawToken, password: newPassword, confirmPassword: newPassword, ...body });
const authorization = (version?: number) => ({ Authorization: 'Bearer ' + jwt.sign({ userId: 'owner', ...(version === undefined ? {} : { authVersion: version }) }, process.env.JWT_SECRET!) });

beforeAll(async () => { hash = await argon2.hash('Old secure password 2026'); });
beforeEach(() => {
  jest.clearAllMocks();
  user = { id: 'owner', email: 'owner@example.com', name: 'Owner', role: 'OWNER', status: 'ACTIVE', authVersion: 0, passwordHash: hash,
    resetTokenHash: resetTokenHash(rawToken), resetExpiresAt: new Date(Date.now() + 15 * 60000), mfaSecret: 'private-mfa-secret' };
  clients.forEach(client => { client.user = db.user; });
  db.user.findUnique.mockImplementation(async () => user);
  db.user.updateMany.mockResolvedValue({ count: 1 }); db.user.update.mockResolvedValue(user);
  (enqueueRecovery as jest.Mock).mockResolvedValue(undefined); (enqueuePasswordChanged as jest.Mock).mockResolvedValue(undefined);
  (sendRecoveryEmail as jest.Mock).mockResolvedValue(undefined);
});

test('queues every valid email identically and never looks up accounts in the request', async () => {
  const known = await request(app).post('/auth/forgot-password').send({ email: 'OWNER@example.com' });
  const unknown = await request(app).post('/auth/forgot-password').send({ email: 'unknown@example.com' });
  expect(known.status).toBe(200); expect(known.body).toEqual(unknown.body);
  expect(enqueueRecovery).toHaveBeenCalledWith('owner@example.com'); expect(enqueueRecovery).toHaveBeenCalledWith('unknown@example.com');
  expect(db.user.findUnique).not.toHaveBeenCalled(); expect(JSON.stringify(known.body)).not.toContain('token');
});
test('rejects invalid emails before queuing', async () => {
  expect((await request(app).post('/auth/forgot-password').send({ email: 'bad' })).status).toBe(400);
  expect(enqueueRecovery).not.toHaveBeenCalled();
});
test.each(['missing', 'expired', 'suspended'])('rejects %s links without changing a password', async condition => {
  if (condition === 'missing') user = null;
  if (condition === 'expired') user.resetExpiresAt = new Date(Date.now() - 1);
  if (condition === 'suspended') user.status = 'SUSPENDED';
  expect((await reset()).status).toBe(400); expect(db.user.updateMany).not.toHaveBeenCalled();
});
test('requires matching passwords and a strong minimum length', async () => {
  expect((await reset({ confirmPassword: 'Different password 2026' })).status).toBe(400);
  expect((await reset({ password: 'short', confirmPassword: 'short' })).status).toBe(400);
  expect(db.user.updateMany).not.toHaveBeenCalled();
});
test('atomically consumes a token, hashes the password, and revokes sessions', async () => {
  expect((await reset()).status).toBe(200);
  const update = db.user.updateMany.mock.calls[0][0];
  expect(update.where).toMatchObject({ id: 'owner', resetTokenHash: resetTokenHash(rawToken), authVersion: 0, status: 'ACTIVE' });
  expect(update.data).toMatchObject({ authVersion: { increment: 1 }, resetTokenHash: null, resetExpiresAt: null });
  expect(await argon2.verify(update.data.passwordHash, newPassword)).toBe(true);
  expect(enqueuePasswordChanged).toHaveBeenCalledWith('owner');
});
test('rejects a token consumed concurrently or replayed', async () => {
  db.user.updateMany.mockResolvedValue({ count: 0 });
  expect((await reset()).status).toBe(400); expect(enqueuePasswordChanged).not.toHaveBeenCalled();
});
test('does not reuse the old password', async () => {
  expect((await reset({ password: 'Old secure password 2026', confirmPassword: 'Old secure password 2026' })).status).toBe(400);
  expect(db.user.updateMany).not.toHaveBeenCalled();
});
test('requires the current password for profile changes', async () => {
  expect((await request(app).put('/auth/profile').set(authorization(0)).send({ password: newPassword, confirmPassword: newPassword })).status).toBe(400);
  expect((await request(app).put('/auth/profile').set(authorization(0)).send({ currentPassword: 'Wrong password', password: newPassword, confirmPassword: newPassword })).status).toBe(400);
  expect(db.user.updateMany).not.toHaveBeenCalled();
});
test.each(['OWNER', 'ADMIN'])('lets %s change only their own password and rotates their token', async role => {
  user.role = role;
  const response = await request(app).put('/auth/profile').set(authorization(0)).send({ currentPassword: 'Old secure password 2026', password: newPassword, confirmPassword: newPassword });
  expect(response.status).toBe(200); expect(jwt.verify(response.body.token, process.env.JWT_SECRET!)).toMatchObject({ userId: 'owner', authVersion: 1 });
  expect(db.user.updateMany.mock.calls[0][0].where).toMatchObject({ id: 'owner', authVersion: 0 });
});
test('rejects old and legacy sessions after revocation, while keeping the new one', async () => {
  user.authVersion = 1;
  expect((await request(app).get('/auth/me').set(authorization())).status).toBe(401);
  expect((await request(app).get('/auth/me').set(authorization(0))).status).toBe(401);
  expect((await request(app).get('/auth/me').set(authorization(1))).status).toBe(200);
});
test('never exposes recovery hashes, MFA secrets, or session versions on login', async () => {
  const response = await request(app).post('/auth/login').send({ email: user.email, password: 'Old secure password 2026' });
  expect(response.status).toBe(200);
  expect(response.body.user).not.toHaveProperty('resetTokenHash'); expect(response.body.user).not.toHaveProperty('mfaSecret'); expect(response.body.user).not.toHaveProperty('authVersion');
});
test('stores only a random-token hash and emails the raw token only to the stored inbox', async () => {
  await issuePasswordRecovery(user.email);
  const [recipient, token] = (sendRecoveryEmail as jest.Mock).mock.calls[0];
  expect(recipient).toBe(user.email); expect(token).toMatch(/^[a-f0-9]{64}$/);
  expect(db.user.updateMany.mock.calls[0][0].data.resetTokenHash).toBe(resetTokenHash(token));
  expect(db.user.updateMany.mock.calls[0][0].data.resetTokenHash).not.toBe(token);
});
test('cooldown does not send another email or change the existing reset token', async () => {
  db.user.updateMany.mockResolvedValue({ count: 0 }); await issuePasswordRecovery(user.email);
  expect(sendRecoveryEmail).not.toHaveBeenCalled();
});
test('delivery failures invalidate just the failed token, allowing a later retry', async () => {
  (sendRecoveryEmail as jest.Mock).mockRejectedValue(new Error('SMTP failure'));
  await expect(issuePasswordRecovery(user.email)).rejects.toThrow('Recovery email delivery failed');
  expect(db.user.updateMany).toHaveBeenCalledTimes(2);
  expect(db.user.updateMany.mock.calls[1][0]).toMatchObject({ where: { id: 'owner' }, data: { resetTokenHash: null, resetExpiresAt: null } });
});
