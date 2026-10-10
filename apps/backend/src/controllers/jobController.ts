import { Request, Response, NextFunction } from 'express';
import { PrismaClient, SiteStatus } from '@prisma/client';
import axios from 'axios';
import { conversionQueue } from '../queue/jobQueue';
import { randomUUID } from 'node:crypto';
import { entitlement } from '../services/plans';
import { processingDuration } from '../services/conversionMetrics';

const prisma = new PrismaClient();
const WORKER_URL = process.env.WORKER_URL || process.env.WORKER_API_URL || 'http://localhost:8000';

export const createJob = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { siteId, url, extractImages, crawlDepth, inferRelations, fullSite, maxPages, maxAssets } = req.body;
    for (const value of [crawlDepth, maxPages, maxAssets]) {
      if (value !== undefined && (!Number.isInteger(value) || value < 0))
        return res.status(400).json({ error: 'Crawl limits must be non-negative integers' });
    }
    let actualUrl = typeof url === 'string' ? url.trim() : '';
    if (!actualUrl) return res.status(400).json({ error: 'URL is required' });
    if (!/^https?:\/\//i.test(actualUrl)) actualUrl = 'https://' + actualUrl;
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
      return { crawl, siteId: site.id };
    });
    try {
      await conversionQueue.add('convert-site', { jobId: result.crawl.id, siteId: result.siteId, url: actualUrl,
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
    if (crawl.logRef) {
      try {
        const workerRes = await axios.get(`${WORKER_URL}/api/jobs/${crawl.logRef}`, { timeout: 3000 });
        workerDetails = workerRes.data.job;

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
            const wStatus = (workerDetails.status || '').toUpperCase();
            let targetCrawlStatus: string | null = null;
            let targetSiteStatus: SiteStatus | null = null;

            if (['COMPLETED', 'VALIDATED', 'READY', 'EXPORTED', 'PACKAGE_APPROVED'].includes(wStatus)) {
              targetCrawlStatus = 'COMPLETED';
              targetSiteStatus = 'READY';
            } else if (['GENERATED', 'GENERATING'].includes(wStatus)) {
              targetCrawlStatus = 'GENERATING';
              targetSiteStatus = 'BUILDING';
            } else if (wStatus === 'CRAWLED') {
              targetCrawlStatus = 'CRAWLED';
              targetSiteStatus = 'ANALYZING';
            } else if (['AWAITING_APPROVAL', 'SCHEMA_PROPOSED'].includes(wStatus)) {
              targetCrawlStatus = 'AWAITING_APPROVAL';
            } else if (wStatus === 'FAILED') {
              targetCrawlStatus = 'FAILED';
              targetSiteStatus = 'FAILED';
            }

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
      } catch (err) {
        // Silently ignore worker connectivity issues on poll
      }
    }
    
    res.json({
      job: {
        ...crawl,
        workerJob: workerDetails
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

    await conversionQueue.add('convert-site', {
      jobId: crawl.id,
      siteId: crawl.siteId,
      url: crawl.startUrl,
      extractImages: true
    }, {
      jobId: `${crawl.id}-${Date.now()}`
    });

    res.json({ job: crawl, message: 'Job execution started' });
  } catch (error) {
    next(error);
  }
};

export const inferSchema = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const crawl = await prisma.crawl.findUnique({ where: { id } });
    if (!crawl) return res.status(404).json({ error: 'Job not found' });

    if (!crawl.logRef) return res.status(409).json({ error: 'Crawl has not started yet' });
    await axios.post(`${WORKER_URL}/api/jobs/${crawl.logRef}/infer-schema`, {}, { timeout: 5000 });

    const updatedCrawl = await prisma.crawl.update({
      where: { id },
      data: { status: 'INFERRING_SCHEMA' }
    });

    res.json({ job: updatedCrawl, message: 'Schema inference started' });
  } catch (error) {
    next(error);
  }
};

export const submitSchemaDecision = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    const { decision, feedback } = req.body;
    const crawl = await prisma.crawl.findUnique({ where: { id } });
    if (!crawl) return res.status(404).json({ error: 'Job not found' });

    if (!crawl.logRef) return res.status(409).json({ error: 'Worker job reference missing' });
    await axios.post(`${WORKER_URL}/api/jobs/${crawl.logRef}/schema-decision`, { decision, feedback }, { timeout: 5000 });

    const updatedCrawl = await prisma.crawl.update({
      where: { id },
      data: { status: decision === 'approved' ? 'GENERATING' : 'INFERRING_SCHEMA' }
    });

    if (crawl.siteId) {
      await prisma.site.update({
        where: { id: crawl.siteId },
        data: { status: decision === 'approved' ? 'BUILDING' : 'ANALYZING' }
      }).catch(() => {});
    }

    res.json({ job: updatedCrawl });
  } catch (error) {
    next(error);
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
