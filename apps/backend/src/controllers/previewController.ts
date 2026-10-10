import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { previewLink } from '../services/previewGateway';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();
export async function preview(req: Request, res: Response, next: NextFunction) {
  try {
    const action = req.method === 'DELETE' ? 'stop' : req.method === 'PUT' ? 'heartbeat' : 'start';
    const lease = String(req.params.lease);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(lease))
      return res.status(400).json({ error: 'Invalid preview session' });
    if (!process.env.PREVIEW_API_SECRET)
      return res.status(503).json({ error: 'Preview requires PREVIEW_API_SECRET on the backend and worker.' });
    const crawl = await prisma.crawl.findUnique({ where: { id: String(req.params.id) } });
    if (!crawl?.logRef) return res.status(409).json({ error: 'Worker output is not available yet' });
    const worker = process.env.WORKER_URL || process.env.WORKER_API_URL || 'http://localhost:8000';
    const result = await axios.post(worker + '/api/jobs/' + crawl.logRef + '/preview/' + action,
      { owner_id: (req as any).account.id, lease_id: lease },
      { headers: { 'X-Preview-Secret': process.env.PREVIEW_API_SECRET }, timeout: 15000 });
    if (result.data.status === 'ready') result.data.url = previewLink(req, (req as any).account.id, lease);
    res.json(result.data);
  } catch (error: any) {
    if (axios.isAxiosError(error)) {
      logger.warn('Preview worker request failed', { code: error.code, status: error.response?.status, action: req.method });
      return res.status(error.response?.status || 503).json({ error: error.response?.data?.detail || 'Preview worker is unavailable' });
    }
    next(error);
  }
}
