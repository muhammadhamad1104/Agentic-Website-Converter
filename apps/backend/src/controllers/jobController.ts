import { Request, Response, NextFunction } from 'express';
import { PrismaClient, SiteStatus } from '@prisma/client';
import axios from 'axios';
import { conversionQueue } from '../queue/jobQueue';
import { randomUUID } from 'node:crypto';
import { entitlement } from '../services/plans';
import { processingDuration } from '../services/conversionMetrics';
import { zipSource } from '../services/sourceUploads';

const prisma = new PrismaClient();
const WORKER_URL = process.env.WORKER_URL || process.env.WORKER_API_URL || 'http://localhost:8000';
const workerOutages = new Map<string, number>();

const workerState = (job: any): { status: string; siteStatus: SiteStatus } | null => {
  const status = String(job?.status || '').toLowerCase();
  if (['failed', 'error', 'cancelled'].includes(status)) return { status: 'FAILED', siteStatus: 'FAILED' };
  if (['completed', 'validated', 'ready', 'exported', 'package_approved'].includes(status))
    return { status: 'COMPLETED', siteStatus: 'READY' };
  if (['approved', 'generating', 'generated', 'template_ready', 'generation_approved', 'backend_generated',
    'frontend_generated', 'admin_generated', 'smoke_validated', 'consistency_validated'].includes(status))
    return { status: 'GENERATING', siteStatus: 'BUILDING' };
  if (['awaiting_approval', 'schema_proposed'].includes(status)) return { status: 'AWAITING_APPROVAL', siteStatus: 'ANALYZING' };
  if (status === 'inferring_schema') return { status: 'INFERRING_SCHEMA', siteStatus: 'ANALYZING' };
  if (['crawled', 'extracted'].includes(status)) return { status: 'CRAWLED', siteStatus: 'ANALYZING' };
  if (['draft', 'pending', 'crawling', 'processing'].includes(status)) return { status: 'PROCESSING', siteStatus: 'ANALYZING' };
  return null;
};

const workerRequestError = (error: any, res: Response, next: NextFunction) => {
  if (error.response?.status) {
    const status = error.response.status;
    return res.status(status >= 500 ? 503 : status).json({ error: error.response.data?.detail || 'Worker request failed', retryable: status >= 500 });
  }
  if (error.isAxiosError || ['ECONNREFUSED', 'ECONNRESET', 'ECONNABORTED', 'ETIMEDOUT'].includes(error.code))
    return res.status(503).json({ error: 'Worker is temporarily unavailable. Retry to resume this conversion.', retryable: true });
  next(error);
};

export const createJob = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { siteId, url, extractImages, crawlDepth, inferRelations, fullSite, maxPages, maxAssets } = req.body;
    for (const value of [crawlDepth, maxPages, maxAssets]) {
      if (value !== undefined && (!Number.isInteger(value) || value < 0))
        return res.status(400).json({ error: 'Crawl limits must be non-negative integers' });
    }
    let actualUrl = typeof url === 'string' ? url.trim() : '';
    if (!actualUrl && !siteId) return res.status(400).json({ error: 'URL or uploaded ZIP project is required' });
    const user = (req as any).account;
    const result = await prisma.$transaction(async tx => {
      // Serialize quota reservation per account, including concurrent browser tabs.
      await tx.user.update({ where: { id: user.id }, data: { updatedAt: new Date() } });
      const access = await entitlement(tx, user);
      if (!access.canConvert) throw Object.assign(new Error('Your 5 Starter conversions are used. Upgrade to Pro for unlimited conversions.'), { statusCode: 403 });
      let site = siteId ? await tx.site.findUnique({ where: { id: siteId } }) : null;
      if (siteId && !site) throw Object.assign(new Error('Site not found'), { statusCode: 404 });
      if (site && site.ownerId !== user.id && user.role !== 'ADMIN')
        throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
      const source = zipSource(site);
      if (source) actualUrl = site.sourceUrl;
      else {
        if (!actualUrl) throw Object.assign(new Error('URL is required'), { statusCode: 400 });
        if (!/^https?:\/\//i.test(actualUrl)) actualUrl = 'https://' + actualUrl;
      }
      if (!site) {
        const host = new URL(actualUrl).hostname;
        site = await tx.site.create({ data: { name: host, slug: host.replace(/[^a-z0-9]+/gi, '-') + '-' + randomUUID(),
          sourceType: 'URL', sourceUrl: actualUrl, status: 'ANALYZING', ownerId: user.id } });
      } else {
        await tx.site.update({ where: { id: site.id }, data: { status: 'ANALYZING' } });
      }
      const crawl = await tx.crawl.create({ data: { siteId: site.id, status: 'PENDING', startUrl: actualUrl } });
      await tx.auditLog.create({ data: { actorUserId: user.id, action: 'conversion.started',
        targetType: 'crawl', targetId: crawl.id, ipHash: 'not-recorded' } });
      return { crawl, siteId: site.id, sourceUploadId: source?.id, sourceOwnerId: source ? site.ownerId : undefined };
    });
    try {
      await conversionQueue.add('convert-site', { jobId: result.crawl.id, siteId: result.siteId, url: actualUrl,
        ...(result.sourceUploadId ? { sourceUploadId: result.sourceUploadId, sourceOwnerId: result.sourceOwnerId } : {}),
        crawlDepth: crawlDepth ?? 3, fullSite: fullSite ?? true, maxPages: maxPages ?? 0, maxAssets: maxAssets ?? 0,
        extractImages: extractImages ?? true, inferRelations: inferRelations ?? true }, { jobId: result.crawl.id });
    } catch (error) {
      await prisma.crawl.update({ where: { id: result.crawl.id }, data: { status: 'FAILED' } });
      throw error;
    }
    res.status(201).json({ job: result.crawl });
  } catch (error: any) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    next(error);
  }
};

export const getJobStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    
    const crawl = await prisma.crawl.findUnique({
      where: { id },
      include: { site: true }
    });
    
    if (!crawl) {
      return res.status(404).json({ error: 'Job not found' });
    }

    let workerDetails: any = null;
    let workerConnection: any = null;
    if (crawl.logRef) {
      try {
        const workerRes = await axios.get(`${WORKER_URL}/api/jobs/${crawl.logRef}`, { timeout: 3000 });
        workerDetails = workerRes.data.job;
        if (!workerDetails?.status) throw new Error('Worker returned no job state');
        workerOutages.delete(crawl.logRef);

        if (workerDetails) {
          const crawlArtifacts = workerDetails.crawl_artifacts || {};
          const totals = crawlArtifacts.totals || {};
          const getLength = (obj: any) => Array.isArray(obj) ? obj.length : (obj && typeof obj === 'object' ? Object.keys(obj).length : 0);
          
          const discoveredAssets = totals.assets_downloaded || 
            workerDetails.counts_by_kind?.assets || 
            crawlArtifacts.asset_count || 
            getLength(crawlArtifacts.assets) || 
            getLength(workerDetails.extraction_report?.assets) || 0;
            
          const crawledPages = totals.pages_crawled || 
            (workerDetails.html_pages || []).length || 
            (workerDetails.crawled_pages || []).length || 0;

          if (discoveredAssets > (crawl.assetsDiscovered || 0) || crawledPages > (crawl.pagesCrawled || 0)) {
            const newAssets = Math.max(crawl.assetsDiscovered || 0, discoveredAssets);
            const newPages = Math.max(crawl.pagesCrawled || 0, crawledPages);
            await prisma.crawl.update({
              where: { id: crawl.id },
              data: {
                assetsDiscovered: newAssets,
                pagesCrawled: newPages
              }
            }).catch(() => {});
            crawl.assetsDiscovered = newAssets;
            crawl.pagesCrawled = newPages;
          }

          if (workerDetails && workerDetails.status) {
            const measured = processingDuration(workerDetails);
            if (measured !== null && measured !== crawl.durationMs) {
              await prisma.crawl.update({ where: { id: crawl.id }, data: { durationMs: measured } });
              crawl.durationMs = measured;
            }
            const mapped = workerState(workerDetails);
            const targetCrawlStatus = mapped?.status;
            const targetSiteStatus = mapped?.siteStatus;

            if (targetCrawlStatus && targetCrawlStatus !== crawl.status) {
              await prisma.crawl.update({
                where: { id: crawl.id },
                data: { status: targetCrawlStatus }
              }).catch(() => {});
              crawl.status = targetCrawlStatus;
            }

            if (targetSiteStatus && crawl.siteId) {
              await prisma.site.update({
                where: { id: crawl.siteId },
                data: { status: targetSiteStatus }
              }).catch(() => {});
            }
          }
        }
      } catch (err: any) {
        const unavailableSince = workerOutages.get(crawl.logRef) ?? Date.now();
        workerOutages.set(crawl.logRef, unavailableSince);
        const missing = err.response?.status === 404;
        workerConnection = { status: missing ? 'missing' : 'unavailable', retryable: !missing, since: unavailableSince,
          message: missing ? 'Worker job is missing. Conversion state could not be recovered.' : 'Worker is temporarily unavailable. Retry to resume this conversion.' };
        // Stop indefinite UI polling without overwriting a conversion that may
        // still be running. A successful later poll restores its real state.
        if (missing || Date.now() - unavailableSince >= 60000) crawl.status = 'FAILED';
      }
    }
    
    res.json({
      job: {
        ...crawl,
        workerJob: workerDetails,
        ...(workerConnection ? { workerConnection } : {})
      }
    });
  } catch (error) {
    next(error);
  }
};

export const runJob = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const crawl = await prisma.crawl.findUnique({ where: { id } });
    if (!crawl) return res.status(404).json({ error: 'Job not found' });

    if (crawl.logRef) {
      const response = await axios.post(`${WORKER_URL}/api/jobs/${crawl.logRef}/run`, {}, { timeout: 5000 });
      const mapped = workerState(response.data.job);
      if (!mapped) return res.status(502).json({ error: 'Worker returned no job state' });
      const updated = await prisma.crawl.update({ where: { id }, data: { status: mapped.status } });
      await prisma.site.update({ where: { id: crawl.siteId }, data: { status: mapped.siteStatus } });
      workerOutages.delete(crawl.logRef);
      return res.json({ job: { ...updated, workerJob: response.data.job }, message: 'Job execution resumed' });
    }

    const queued = await conversionQueue.getJob(crawl.id);
    if (queued) {
      const state = await queued.getState();
      if (state === 'failed') await queued.retry();
      else if (state === 'completed') await queued.remove();
      if (state !== 'completed') return res.json({ job: crawl, message: 'Job execution queued' });
    }

    const site = await prisma.site.findUnique({ where: { id: crawl.siteId } });
    const source = zipSource(site);
    await conversionQueue.add('convert-site', {
      jobId: crawl.id,
      siteId: crawl.siteId,
      url: crawl.startUrl,
      crawlDepth: crawl.maxDepth,
      ...(source ? { sourceUploadId: source.id, sourceOwnerId: site.ownerId } : {}),
      extractImages: true
    }, {
      jobId: crawl.id
    });

    res.json({ job: crawl, message: 'Job execution started' });
  } catch (error) {
    workerRequestError(error, res, next);
  }
};

export const inferSchema = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const crawl = await prisma.crawl.findUnique({ where: { id } });
    if (!crawl) return res.status(404).json({ error: 'Job not found' });

    if (!crawl.logRef) return res.status(409).json({ error: 'Crawl has not started yet' });
    const response = await axios.post(`${WORKER_URL}/api/jobs/${crawl.logRef}/infer-schema`, {}, { timeout: 5000 });
    const mapped = workerState(response.data.job);
    if (!mapped) return res.status(502).json({ error: 'Worker returned no job state' });

    const updatedCrawl = await prisma.crawl.update({
      where: { id },
      data: { status: mapped.status }
    });

    res.json({ job: { ...updatedCrawl, workerJob: response.data.job }, message: response.data.message || 'Schema inference started' });
  } catch (error) {
    workerRequestError(error, res, next);
  }
};

export const submitSchemaDecision = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const { decision, feedback } = req.body;
    if (!['approved', 'rejected', 'pending'].includes(decision))
      return res.status(400).json({ error: 'Decision must be approved, rejected, or pending' });
    const crawl = await prisma.crawl.findUnique({ where: { id } });
    if (!crawl) return res.status(404).json({ error: 'Job not found' });

    if (!crawl.logRef) return res.status(409).json({ error: 'Worker job reference missing' });
    const response = await axios.post(`${WORKER_URL}/api/jobs/${crawl.logRef}/schema-decision`, { decision, feedback }, { timeout: 5000 });
    const mapped = workerState(response.data.job);
    if (!mapped) return res.status(502).json({ error: 'Worker returned no job state' });

    const updatedCrawl = await prisma.crawl.update({
      where: { id },
      data: { status: mapped.status }
    });

    if (crawl.siteId) {
      await prisma.site.update({
        where: { id: crawl.siteId },
        data: { status: mapped.siteStatus }
      }).catch(() => {});
    }

    res.json({ job: { ...updatedCrawl, workerJob: response.data.job } });
  } catch (error) {
    workerRequestError(error, res, next);
  }
};

export const exportJob = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const crawl = await prisma.crawl.findUnique({ where: { id } });
    if (!crawl) return res.status(404).json({ error: 'Job not found' });

    if (crawl.logRef) {
      // Just return the download URL, the actual ZIP generation is handled in download
      return res.json({ url: `/api/jobs/${id}/download` });
    }

    res.json({ url: `/api/jobs/${id}/download` });
  } catch (error) {
    next(error);
  }
};

export const downloadJobZip = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const crawl = await prisma.crawl.findUnique({ where: { id } });
    if (!crawl) return res.status(404).json({ error: 'Job not found' });

    if (!crawl.logRef) {
      return res.status(400).json({ error: 'Worker job reference missing' });
    }

    // Proxy request to worker export endpoint to get the zip stream
    const response = await axios({
      method: 'POST',
      url: `${WORKER_URL}/api/jobs/${crawl.logRef}/export`,
      responseType: 'stream'
    });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="converted-site-${id}.zip"`);
    response.data.pipe(res);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to download project package', details: error.message });
  }
};
