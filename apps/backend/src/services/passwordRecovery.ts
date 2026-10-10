import { createHash, randomBytes } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { sendRecoveryEmail } from './recoveryMail';

const prisma = new PrismaClient();
export const resetTokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export const RESET_TOKEN_PATTERN = /^[a-f0-9]{64}$/;

export async function issuePasswordRecovery(email: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.status !== 'ACTIVE') return;
  const token = randomBytes(32).toString('hex');
  const hash = resetTokenHash(token);
  const now = new Date();
  const result = await prisma.user.updateMany({
    where: { id: user.id, status: 'ACTIVE', authVersion: user.authVersion,
      OR: [{ resetRequestedAt: null }, { resetRequestedAt: { lt: new Date(now.getTime() - 5 * 60 * 1000) } }] },
    data: { resetTokenHash: hash, resetExpiresAt: new Date(now.getTime() + 15 * 60 * 1000), resetRequestedAt: now },
  });
  if (!result.count) return;
  try { await sendRecoveryEmail(user.email, token); }
  catch {
    await prisma.user.updateMany({ where: { id: user.id, resetTokenHash: hash }, data: { resetTokenHash: null, resetExpiresAt: null, resetRequestedAt: null } });
    throw new Error('Recovery email delivery failed');
  }
}
