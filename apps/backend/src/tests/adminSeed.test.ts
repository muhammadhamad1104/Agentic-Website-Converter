import { adminSeedConfiguration, seedAdministrator } from '../seeds/run';
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

jest.mock('@prisma/client', () => ({ PrismaClient: jest.fn(() => ({
  user: { findUnique: jest.fn(), create: jest.fn() }, $disconnect: jest.fn(),
})) }));
jest.mock('argon2', () => ({ hash: jest.fn().mockResolvedValue('hashed-test-password') }));
const env = { SEED_ADMIN_EMAIL: 'ADMIN@EXAMPLE.COM', SEED_ADMIN_PASSWORD: 'Test-only-seed-password' };

describe('Administrator handover setup', () => {
  beforeEach(() => { jest.clearAllMocks(); });
  test('requires explicit valid credentials and normalizes the email', () => {
    expect(adminSeedConfiguration(env)).toMatchObject({ email: 'admin@example.com', name: 'Administrator' });
    for (const invalid of [{}, { ...env, SEED_ADMIN_PASSWORD: 'short' }, { ...env, SEED_ADMIN_EMAIL: 'invalid' }])
      expect(() => adminSeedConfiguration(invalid)).toThrow('SEED_ADMIN_EMAIL');
  });
  test('creates a real ADMIN with a hashed password', async () => {
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() }, $disconnect: jest.fn() };
    jest.mocked(PrismaClient).mockReturnValueOnce(prisma as any);
    const saved = { ...process.env };
    Object.assign(process.env, env);
    try {
      await seedAdministrator();
      expect(argon2.hash).toHaveBeenCalledWith(env.SEED_ADMIN_PASSWORD);
      expect(prisma.user.create).toHaveBeenCalledWith({ data: {
        email: 'admin@example.com', name: 'Administrator', role: 'ADMIN', passwordHash: 'hashed-test-password',
      } });
      expect(prisma.$disconnect).toHaveBeenCalled();
    } finally { process.env = saved; }
  });
  test.each(['ADMIN', 'OWNER'])('does not reset or silently elevate an existing %s', async role => {
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue({ role }), create: jest.fn() }, $disconnect: jest.fn() };
    jest.mocked(PrismaClient).mockReturnValueOnce(prisma as any);
    const saved = { ...process.env };
    Object.assign(process.env, env);
    try {
      if (role === 'ADMIN') await expect(seedAdministrator()).resolves.toBeUndefined();
      else await expect(seedAdministrator()).rejects.toThrow('non-admin');
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.$disconnect).toHaveBeenCalled();
    } finally { process.env = saved; }
  });
});
