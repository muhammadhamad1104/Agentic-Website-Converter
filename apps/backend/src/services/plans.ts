import { PrismaClient } from '@prisma/client';

export const PLAN_CATALOG = {
  STARTER: { name: 'Starter', conversionLimit: 5, priceCents: 0, currency: 'usd', billing: 'free' },
  PRO: { name: 'Pro', conversionLimit: null, priceCents: 19900, currency: 'usd', billing: 'one-time' },
  ADMIN: { name: 'Admin', conversionLimit: null, priceCents: 0, currency: 'usd', billing: 'internal' },
} as const;

export function planFor(user: { role: string; plan?: string }) {
  const key = user.role === 'ADMIN' ? 'ADMIN' : user.plan === 'PRO' ? 'PRO' : 'STARTER';
  return { key, ...PLAN_CATALOG[key] };
}

export async function conversionUsage(db: any, userId: string) {
  // Audit entries survive project deletion. Include legacy jobs not yet recorded.
  const logs = await db.auditLog.findMany({
    where: { actorUserId: userId, action: 'conversion.started' }, select: { targetId: true },
  });
  const legacy = await db.crawl.count({
    where: { site: { ownerId: userId }, ...(logs.length ? { id: { notIn: logs.map((row: any) => row.targetId) } } : {}) },
  });
  return logs.length + legacy;
}

export async function entitlement(db: PrismaClient | any, user: { id: string; role: string; plan?: string }) {
  const plan = planFor(user);
  const used = await conversionUsage(db, user.id);
  return { ...plan, used, remaining: plan.conversionLimit === null ? null : Math.max(0, plan.conversionLimit - used),
    canConvert: plan.conversionLimit === null || used < plan.conversionLimit, canExport: true, canPreview: true };
}
