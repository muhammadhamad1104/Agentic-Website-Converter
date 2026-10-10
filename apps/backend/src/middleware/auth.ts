import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as { userId?: string; authVersion?: number };
    if (!decoded.userId) return res.status(401).json({ error: 'Invalid account token' });
    const account = await prisma.user.findUnique({ where: { id: decoded.userId },
      select: { id: true, role: true, plan: true, status: true, authVersion: true } });
    if (!account || account.status !== 'ACTIVE') return res.status(401).json({ error: 'Account is unavailable' });
    if ((decoded.authVersion ?? 0) !== (account.authVersion ?? 0)) return res.status(401).json({ error: 'Your session expired. Sign in again.' });
    (req as any).account = account;
    (req as any).user = { userId: account.id, role: account.role };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};

export const requireJobAccess = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const job = await prisma.crawl.findUnique({ where: { id: String(req.params.id) }, include: { site: true } });
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if ((req as any).account.role !== 'ADMIN' && job.site.ownerId !== (req as any).account.id)
      return res.status(403).json({ error: 'Forbidden' });
    next();
  } catch (error) { next(error); }
};
