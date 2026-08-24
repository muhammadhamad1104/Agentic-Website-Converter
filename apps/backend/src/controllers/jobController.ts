import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { conversionQueue } from '../queue/jobQueue';

const prisma = new PrismaClient();
const WORKER_URL = process.env.WORKER_API_URL || 'http://localhost:8000';

export const createJob = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { siteId, url, extractImages, crawlDepth, inferRelations } = req.body;
    
    let actualUrl = (url || '').trim();
    if (!actualUrl) {
      return res.status(400).json({ error: 'URL is required' });
    }
    if (!/^https?:\/\//i.test(actualUrl)) {
      actualUrl = `https://${actualUrl}`;
    }

    // Check user plan/role
    const userId = (req as any).user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // 3-Tier Conversion Limit Check:
    // ADMIN: Unlimited
    // PRO: Max 50 conversions
    // STARTER/Free: Max 5 conversions
    if (user.role !== 'ADMIN') {
      const userSites = await prisma.site.findMany({
        where: { ownerId: user.id },
        select: { id: true }
      });
      const siteIds = userSites.map(s => s.id);
      
      const totalConversions = await prisma.crawl.count({
        where: { siteId: { in: siteIds } }
      });

      if (user.plan === 'PRO' && totalConversions >= 50) {
        return res.status(403).json({ error: 'PRO plan limit reached (50 conversions max)' });
      } else if (user.plan !== 'PRO' && totalConversions >= 5) {
        return res.status(403).json({ error: 'Starter plan limit reached (5 conversions max). Upgrade to PRO for more.' });
      }
    }

    // Ensure siteId is present or create a site on the fly if needed
    let targetSiteId = siteId;
    if (!targetSiteId) {
      let parsedHost = 'site';
      try {
        parsedHost = new URL(actualUrl).hostname;
      } catch (e) {}
      const site = await prisma.site.create({
        data: {
          name: parsedHost,
          slug: parsedHost.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Math.random().toString(36).substring(2, 7),
          sourceType: 'URL',
          sourceUrl: actualUrl,
          status: 'ANALYZING',
          ownerId: user.id
        }
      });
      targetSiteId = site.id;
    } else {
      await prisma.site.update({
        where: { id: targetSiteId },
        data: { status: 'ANALYZING' }
      });
    }
    
    // Create DB Crawl Record
    const crawl = await prisma.crawl.create({
      data: {
        siteId: targetSiteId,
        status: 'PENDING',
        startUrl: actualUrl
      }
    });
    
    // Add job to BullMQ queue with dynamic depth and features
    await conversionQueue.add('convert-site', {
      jobId: crawl.id,
      siteId: targetSiteId,
      url: actualUrl,
      crawlDepth: crawlDepth || 2,
      extractImages: extractImages ?? true,
      inferRelations: inferRelations ?? true
    }, {
      jobId: crawl.id
    });
    
    res.status(201).json({ job: crawl });
  } catch (error) {
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
            const wStatus = (workerDetails.status || '').toUpperCase();
            let targetCrawlStatus: string | null = null;
            let targetSiteStatus: string | null = null;

            if (['COMPLETED', 'VALIDATED', 'READY', 'EXPORTED', 'PACKAGE_APPROVED'].includes(wStatus)) {
              targetCrawlStatus = 'COMPLETED';
              targetSiteStatus = 'READY';
            } else if (['GENERATED', 'GENERATING'].includes(wStatus)) {
              targetCrawlStatus = 'GENERATING';
              targetSiteStatus = 'GENERATING';
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

    if (crawl.logRef) {
      try {
        await axios.post(`${WORKER_URL}/api/jobs/${crawl.logRef}/infer-schema`, {}, { timeout: 5000 });
      } catch (err) {}
    }

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

    if (crawl.logRef) {
      try {
        await axios.post(`${WORKER_URL}/api/jobs/${crawl.logRef}/schema-decision`, { decision, feedback }, { timeout: 5000 });
      } catch (err) {}
    }

    const updatedCrawl = await prisma.crawl.update({
      where: { id },
      data: { status: decision === 'approved' ? 'GENERATING' : 'INFERRING_SCHEMA' }
    });

    if (crawl.siteId) {
      await prisma.site.update({
        where: { id: crawl.siteId },
        data: { status: decision === 'approved' ? 'GENERATING' : 'ANALYZING' }
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

