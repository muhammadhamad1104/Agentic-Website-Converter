import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();
const WORKER_URL = process.env.WORKER_URL || process.env.WORKER_API_URL || 'http://localhost:8000';

export const getSites = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const [sites, total] = await Promise.all([
      prisma.site.findMany({
        where: { ownerId: userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          crawls: {
            orderBy: { createdAt: 'desc' },
            take: 1
          },
          entities: true
        }
      }),
      prisma.site.count({ where: { ownerId: userId } })
    ]);

    // Fetch live stats from python worker for each site concurrently
    const formattedSites = await Promise.all(sites.map(async (site) => {
      const latestCrawl = site.crawls[0];
      let pages = latestCrawl?.pagesCrawled || 0;
      let models = site.entities.length;
      let assets = latestCrawl?.assetsDiscovered || 0;
      let durationMs = 0;
      let status = site.status;
      
      if (latestCrawl?.logRef) {
        try {
          const workerRes = await axios.get(`${WORKER_URL}/api/jobs/${latestCrawl.logRef}`, { timeout: 2000 });
          const workerJob = workerRes.data.job;
          
            if (workerJob) {
              const crawlConfig = workerJob.crawl_config || {};
              const crawlArtifacts = workerJob.crawl_artifacts || {};
              const totals = crawlArtifacts.totals || {};

              const workerPages = totals.pages_crawled || 
                (workerJob.html_pages || []).length || 
                (workerJob.crawled_pages || []).length || 
                (crawlConfig.html_pages ? crawlConfig.html_pages.length : 0);
              pages = Math.max(pages, workerPages);
              
              const getLength = (obj: any) => Array.isArray(obj) ? obj.length : (obj && typeof obj === 'object' ? Object.keys(obj).length : 0);
              
              const workerAssets = totals.assets_downloaded || 
                workerJob.counts_by_kind?.assets ||
                crawlArtifacts.asset_count ||
                getLength(crawlArtifacts.assets) || 
                getLength(workerJob.extraction_report?.assets) || 0;
              assets = Math.max(assets || 0, workerAssets);

              if (latestCrawl && (assets > (latestCrawl.assetsDiscovered || 0) || pages > (latestCrawl.pagesCrawled || 0))) {
                prisma.crawl.update({
                  where: { id: latestCrawl.id },
                  data: {
                    assetsDiscovered: Math.max(latestCrawl.assetsDiscovered || 0, assets),
                    pagesCrawled: Math.max(latestCrawl.pagesCrawled || 0, pages)
                  }
                }).catch(() => {});
              }

              const schema = workerJob.schema_proposal || {};
              const entities = schema.entities || schema.models || [];
              models = entities.length;
              
              const realArtifacts = workerJob.generated_artifacts || {};
              if (realArtifacts.prisma_schema && models === 0) {
                 const matches = realArtifacts.prisma_schema.match(/model\s+\w+/g);
                 if (matches) models = matches.length;
              }
              
              // Map worker status if it exists and is more advanced
            const workerStatus = (workerJob.status || '').toUpperCase();
            if (['INFERRING_SCHEMA', 'AWAITING_APPROVAL', 'GENERATING', 'GENERATED', 'VALIDATED', 'COMPLETED', 'FAILED', 'READY'].includes(workerStatus)) {
              status = workerStatus;
            }

            if (workerJob.duration_ms && workerJob.duration_ms > 0) {
              durationMs = Math.round(workerJob.duration_ms);
            } else if (workerJob.created_at_ms && workerJob.updated_at_ms) {
              durationMs = Math.round(Math.max(0, workerJob.updated_at_ms - workerJob.created_at_ms));
            } else if (Array.isArray(workerJob.trace_events) && workerJob.trace_events.length > 1) {
              const first = workerJob.trace_events[0];
              const last = workerJob.trace_events[workerJob.trace_events.length - 1];
              const t0 = first?.timestamp_ms || (first?.timestamp ? new Date(first.timestamp).getTime() : 0);
              const tN = last?.timestamp_ms || (last?.timestamp ? new Date(last.timestamp).getTime() : 0);
              if (t0 && tN && tN > t0) {
                durationMs = tN - t0;
              }
            }

            if (durationMs === 0 && latestCrawl) {
              const created = new Date(latestCrawl.createdAt).getTime();
              const updated = new Date(latestCrawl.updatedAt).getTime();
              if (updated > created) {
                durationMs = updated - created;
              }
            }
          }
        } catch (err) {
          // Ignore network errors to worker
        }
      }

      if (durationMs === 0 && latestCrawl) {
        const created = new Date(latestCrawl.createdAt).getTime();
        const updated = new Date(latestCrawl.updatedAt).getTime();
        if (updated > created) {
          durationMs = updated - created;
        }
      }

      return {
        id: site.id,
        name: site.name,
        slug: site.slug,
        status,
        pages,
        models,
        assets,
        durationMs,
        lastRun: latestCrawl ? latestCrawl.createdAt : site.createdAt,
      };
    }));

    res.json({ sites: formattedSites, total });
  } catch (error) {
    next(error);
  }
};

export const getSiteById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user?.userId;
    const id = req.params.id as string;

    const site = await prisma.site.findUnique({
      where: { id },
      include: {
        crawls: { orderBy: { createdAt: 'desc' } },
        entities: true,
      }
    });

    if (!site) return res.status(404).json({ error: 'Site not found' });
    if (site.ownerId !== userId) return res.status(403).json({ error: 'Forbidden' });

    const latestCrawl = site.crawls[0];
    let stats = {
      pages: latestCrawl?.pagesCrawled || 0,
      models: site.entities.length,
      assets: latestCrawl?.assetsDiscovered || 0,
      apiRoutes: site.entities.length * 5,
      components: (site.entities.length * 3) + (latestCrawl?.pagesCrawled || 0) + 5,
      durationMs: 0
    };

    if (latestCrawl?.logRef) {
      try {
        const workerRes = await axios.get(`${WORKER_URL}/api/jobs/${latestCrawl.logRef}`, { timeout: 2000 });
        const workerJob = workerRes.data.job;
        
        if (workerJob) {
          const crawlConfig = workerJob.crawl_config || {};
          const crawlArtifacts = workerJob.crawl_artifacts || {};
          const totals = crawlArtifacts.totals || {};

          const workerPages = totals.pages_crawled || 
            (workerJob.html_pages || []).length || 
            (workerJob.crawled_pages || []).length || 
            (crawlConfig.html_pages ? crawlConfig.html_pages.length : 0);
          stats.pages = Math.max(stats.pages, workerPages);
          
          const getLength = (obj: any) => Array.isArray(obj) ? obj.length : (obj && typeof obj === 'object' ? Object.keys(obj).length : 0);
          
          const workerAssets = totals.assets_downloaded || 
            workerJob.counts_by_kind?.assets ||
            crawlArtifacts.asset_count ||
            getLength(crawlArtifacts.assets) || 
            getLength(workerJob.extraction_report?.assets) || 0;
          stats.assets = Math.max(stats.assets || 0, workerAssets);

          if (latestCrawl && (stats.assets > (latestCrawl.assetsDiscovered || 0) || stats.pages > (latestCrawl.pagesCrawled || 0))) {
            prisma.crawl.update({
              where: { id: latestCrawl.id },
              data: {
                assetsDiscovered: Math.max(latestCrawl.assetsDiscovered || 0, stats.assets),
                pagesCrawled: Math.max(latestCrawl.pagesCrawled || 0, stats.pages)
              }
            }).catch(() => {});
          }

          const schema = workerJob.schema_proposal || {};
          let workerEntities = schema.entities || schema.models || [];
          const realArtifacts = workerJob.generated_artifacts || {};

          if (workerEntities.length === 0 && realArtifacts.prisma_schema) {
            const modelBlocks = realArtifacts.prisma_schema.match(/model\s+(\w+)\s*\{([^}]+)\}/g) || [];
            workerEntities = modelBlocks.map((block: string, i: number) => {
              const nameMatch = block.match(/model\s+(\w+)/);
              const modelName = nameMatch ? nameMatch[1] : `Model_${i + 1}`;
              const fieldLines = block.split('\n').filter(line => line.trim() && !line.includes('model ') && !line.includes('}'));
              const fields = fieldLines.map((line, j) => {
                const parts = line.trim().split(/\s+/);
                return {
                  id: parts[0] || `field_${j}`,
                  name: parts[0] || 'field',
                  type: parts[1] || 'String'
                };
              }).filter(f => f.name && !f.name.startsWith('@') && f.name !== 'createdAt' && f.name !== 'updatedAt');

              return {
                id: modelName,
                name: modelName,
                fields
              };
            });
          }

          if (workerEntities.length > 0) {
            stats.models = Math.max(stats.models, workerEntities.length);
            if (site.entities.length === 0) {
              (site as any).entities = workerEntities.map((e: any, i: number) => ({
                id: e.id || e.name || `entity_${i}`,
                name: e.name,
                fields: (e.fields || []).map((f: any, j: number) => ({
                  id: f.id || f.name || `field_${i}_${j}`,
                  name: f.name,
                  type: f.type || 'String'
                }))
              }));
            }
          } else if (site.entities.length > 0) {
            stats.models = site.entities.length;
          }

          // Exact logic based on generator architecture
          if (stats.models > 0) {
            stats.apiRoutes = stats.models * 5;
            stats.components = (stats.models * 3) + stats.pages + 5;
          }
          
          if (workerJob.created_at && workerJob.updated_at && ['COMPLETED', 'VALIDATED', 'READY'].includes((workerJob.status || '').toUpperCase())) {
            const created = new Date(workerJob.created_at).getTime();
            const updated = new Date(workerJob.updated_at).getTime();
            stats.durationMs = updated - created;
          }
        }
      } catch (err) {
        // Ignore network errors to worker
      }
    }

    res.json({ site, stats });
  } catch (error) {
    next(error);
  }
};

export const checkStaticWebsite = async (url: string): Promise<{ valid: boolean; error?: string; message?: string }> => {
  let targetUrl = (url || '').trim();
  if (!targetUrl) {
    return { valid: false, error: 'URL is required' };
  }
  if (!/^https?:\/\//i.test(targetUrl)) {
    targetUrl = `https://${targetUrl}`;
  }

  try {
    const response = await axios.get(targetUrl, {
      timeout: 7000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      maxRedirects: 5,
    });

    const contentTypeHeader = response.headers['content-type'];
    const contentType = String(contentTypeHeader || '').toLowerCase();
    if (!contentType.includes('text/html') && !contentType.includes('xhtml')) {
      return {
        valid: false,
        error: 'Target URL is not an HTML website (Content-Type is not text/html).'
      };
    }

    const htmlText = typeof response.data === 'string' ? response.data : String(response.data || '');
    const lowerHtml = htmlText.toLowerCase();

    // Detect React, Next.js, Vue, Nuxt, Angular, Svelte client-side SPA signatures
    const isNextJs = lowerHtml.includes('/_next/') || lowerHtml.includes('__next_data__') || lowerHtml.includes('__next_f') || lowerHtml.includes('self.__next') || lowerHtml.includes('next-head-count');
    const isReactApp = lowerHtml.includes('react-dom') || lowerHtml.includes('react.production') || lowerHtml.includes('react.development') || lowerHtml.includes('__react') || (lowerHtml.includes('id="root"') && (lowerHtml.includes('script') || lowerHtml.includes('bundle') || lowerHtml.includes('static/js')));
    const isVueNuxt = lowerHtml.includes('__nuxt') || lowerHtml.includes('/_nuxt/') || lowerHtml.includes('data-v-') || lowerHtml.includes('vue.runtime') || lowerHtml.includes('vue.global') || (lowerHtml.includes('id="app"') && lowerHtml.includes('vue'));
    const isAngular = lowerHtml.includes('ng-version') || lowerHtml.includes('<app-root');
    const isSvelte = lowerHtml.includes('/_app/immutable/') || lowerHtml.includes('svelte-') || lowerHtml.includes('__svelte');

    // Check if site uses any framework or client-side rendering bundle
    if (isNextJs || isReactApp || isVueNuxt || isAngular || isSvelte) {
      let frameworkName = "React / Next.js";
      if (isNextJs) frameworkName = "Next.js (React Server Components)";
      else if (isReactApp) frameworkName = "React SPA Application";
      else if (isVueNuxt) frameworkName = "Vue / Nuxt Application";
      else if (isAngular) frameworkName = "Angular Application";
      else if (isSvelte) frameworkName = "Svelte / SvelteKit";

      return {
        valid: false,
        error: `Target URL (${targetUrl}) is a ${frameworkName} site. The converter requires a static HTML/CSS/JS website.`
      };
    }

    // SPA empty shell check (lack of static HTML text content in body)
    const textOnly = lowerHtml
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, '')
      .trim();

    if (textOnly.length < 80 && (lowerHtml.includes('<script') || lowerHtml.includes('id="root"') || lowerHtml.includes('id="app"'))) {
      return {
        valid: false,
        error: `Target URL (${targetUrl}) is a Single Page Application (SPA) shell with no static HTML content.`
      };
    }

    return { valid: true, message: 'Valid static HTML/CSS/JS target website' };
  } catch (fetchErr: any) {
    return {
      valid: false,
      error: `Could not reach target website (${fetchErr.message || 'Connection timeout'}). Please verify the URL.`
    };
  }
};

export const createSite = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { url, sourceUrl, name, sourceType } = req.body;
    let actualUrl = (url || sourceUrl || '').trim();
    if (!actualUrl) return res.status(400).json({ error: 'URL is required' });

    if (!/^https?:\/\//i.test(actualUrl)) {
      actualUrl = `https://${actualUrl}`;
    }

    // Validate that target site is static HTML/CSS/JS before creation
    if (sourceType !== 'FILE') {
      const validation = await checkStaticWebsite(actualUrl);
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }
    }

    // 3-Tier User Limit Check:
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user?.role !== 'ADMIN') {
      const siteCount = await prisma.site.count({ where: { ownerId: userId } });
      
      if (user?.plan === 'PRO' && siteCount >= 10) {
        return res.status(403).json({ error: 'PRO plan limit reached (10 sites max)' });
      } else if (user?.plan !== 'PRO' && siteCount >= 2) {
        return res.status(403).json({ error: 'Starter plan limit reached (2 sites max). Upgrade to PRO for more.' });
      }
    }

    let parsedHost = 'site';
    try {
      parsedHost = new URL(actualUrl).hostname;
    } catch (e) {}

    const siteName = name || parsedHost;
    const slug = siteName.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Math.random().toString(36).substring(2, 7);

    const site = await prisma.site.create({
      data: {
        name: siteName,
        slug,
        sourceType: sourceType || 'URL',
        sourceUrl: actualUrl,
        status: 'NEW',
        ownerId: userId,
      }
    });

    res.status(201).json({ site });
  } catch (error) {
    next(error);
  }
};

export const deleteSite = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).user?.userId;
    const id = req.params.id as string;

    const site = await prisma.site.findUnique({ where: { id } });
    if (!site) return res.status(404).json({ error: 'Site not found' });
    if (site.ownerId !== userId) return res.status(403).json({ error: 'Forbidden' });

    await prisma.site.delete({ where: { id } });
    res.json({ message: 'Site deleted' });
  } catch (error) {
    next(error);
  }
};

export const validateSiteUrl = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { url } = req.body;
    const result = await checkStaticWebsite(url);
    if (!result.valid) {
      return res.status(400).json(result);
    }
    return res.json(result);
  } catch (error) {
    next(error);
  }
};

