import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { entitlement, PLAN_CATALOG, planFor } from '../services/plans';
import { refreshConversionMetrics } from '../services/conversionMetrics';

const prisma = new PrismaClient();
const active = ['PENDING', 'DRAFT', 'PROCESSING', 'ANALYZING', 'CRAWLED', 'EXTRACTED', 'INFERRING_SCHEMA', 'SCHEMA_PROPOSED', 'AWAITING_APPROVAL', 'APPROVED', 'GENERATING', 'GENERATED'];

export const catalog = (_req: Request, res: Response) => res.json({ plans: PLAN_CATALOG });

export const summary = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).account;
    await refreshConversionMetrics(prisma, user.id);
    const where = { site: { ownerId: user.id } };
    const [plan, totalSites, totalConversions, activeJobs, completedJobs, failedJobs, durations] = await Promise.all([
      entitlement(prisma, user), prisma.site.count({ where: { ownerId: user.id } }),
      prisma.crawl.count({ where }), prisma.crawl.count({ where: { ...where, status: { in: active } } }),
      prisma.crawl.count({ where: { ...where, status: 'COMPLETED' } }),
      prisma.crawl.count({ where: { ...where, status: 'FAILED' } }),
      prisma.crawl.aggregate({ where: { ...where, status: { in: ['COMPLETED', 'FAILED'] }, durationMs: { not: null } },
        _avg: { durationMs: true }, _count: { durationMs: true } }),
    ]);
    res.json({ plan, stats: { totalSites, totalConversions: plan.used, activeJobs, completedJobs, failedJobs,
      averageDurationMs: durations._avg.durationMs, timedConversions: durations._count.durationMs } });
  } catch (error) { next(error); }
};

export const adminSummary = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if ((req as any).account.role !== 'ADMIN') return res.status(403).json({ error: 'Admin access required' });
    await refreshConversionMetrics(prisma);
    const [users, sites, jobs, failedJobs, activeJobs, durations, planGroups, recentUsers, recentJobs] = await Promise.all([
      prisma.user.count(), prisma.site.count(), prisma.crawl.count(),
      prisma.crawl.count({ where: { status: 'FAILED' } }), prisma.crawl.count({ where: { status: { in: active } } }),
      prisma.crawl.aggregate({ where: { status: { in: ['COMPLETED', 'FAILED'] }, durationMs: { not: null } },
        _avg: { durationMs: true }, _count: { durationMs: true } }),
      prisma.user.groupBy({ by: ['role', 'plan'], _count: true }),
      prisma.user.findMany({ orderBy: { createdAt: 'desc' }, take: 10,
        select: { id: true, name: true, email: true, role: true, plan: true, status: true, createdAt: true } }),
      prisma.crawl.findMany({ orderBy: { createdAt: 'desc' }, take: 12,
        select: { id: true, status: true, durationMs: true, createdAt: true, site: { select: { id: true, name: true, owner: { select: { email: true } } } } } }),
    ]);
    const membershipCounts = new Map<string, number>();
    for (const group of planGroups) {
      const key = planFor(group).key;
      membershipCounts.set(key, (membershipCounts.get(key) || 0) + group._count);
    }
    const plans = Array.from(membershipCounts, ([plan, _count]) => ({ plan, _count }));
    res.json({ stats: { users, sites, jobs, failedJobs, activeJobs, averageDurationMs: durations._avg.durationMs,
      timedConversions: durations._count.durationMs }, plans, recentUsers, recentJobs });
  } catch (error) { next(error); }
};
