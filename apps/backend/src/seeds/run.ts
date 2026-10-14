import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import Joi from 'joi';

export function adminSeedConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const { error, value } = Joi.object({
    email: Joi.string().trim().lowercase().email().required(),
    password: Joi.string().min(12).max(256).required(),
    name: Joi.string().trim().min(1).max(120).required(),
  }).validate({ email: env.SEED_ADMIN_EMAIL, password: env.SEED_ADMIN_PASSWORD, name: env.SEED_ADMIN_NAME || 'Administrator' });
  if (error) throw new Error('Set a valid SEED_ADMIN_EMAIL and a SEED_ADMIN_PASSWORD of 12 to 256 characters in .env.');
  return value as { email: string; password: string; name: string };
}

export async function seedAdministrator() {
  const config = adminSeedConfiguration();
  const prisma = new PrismaClient();
  try {
    const existing = await prisma.user.findUnique({ where: { email: config.email } });
    if (existing) {
      if (existing.role !== 'ADMIN') throw new Error('An existing non-admin account uses this email. Choose a different seed email.');
      console.log('Administrator already exists. No password or account details were changed.');
      return;
    }
    await prisma.user.create({ data: {
      email: config.email, name: config.name, passwordHash: await argon2.hash(config.password), role: 'ADMIN',
    } });
    console.log('Administrator created. Credentials are read from .env and are never printed.');
  } finally { await prisma.$disconnect(); }
}

if (require.main === module) {
  seedAdministrator().catch(() => {
    console.error('Administrator setup failed. Check seed configuration, account ownership, and database connectivity.');
    process.exitCode = 1;
  });
}
