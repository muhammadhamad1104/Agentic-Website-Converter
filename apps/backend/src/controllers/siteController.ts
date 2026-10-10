import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { workerMetrics, processingDuration } from '../services/conversionMetrics';

const prisma = new PrismaClient();
const WORKER_URL = process.env.WORKER_URL || process.env.WORKER_API_URL || 'http://localhost:8000';

async function loadWorker(crawl: any) {
  if (!crawl?.logRef) return null;
  try { return (await axios.get(WORKER_URL + '/api/jobs/' + crawl.logRef, { timeout: 4000 })).data.job; }
  catch { return null; }
}

async function synchronize(crawl: any, worker: any) {
  if (!crawl || !worker) return;
  const measured = processingDuration(worker);
  const metrics = workerMetrics(worker, crawl);
  const status = String(worker.status).toLowerCase();
  const terminal = ['validated', 'completed', 'ready'].includes(status) ? 'COMPLETED' : status === 'failed' ? 'FAILED' : null;
  await prisma.crawl.update({ where: { id: crawl.id }, data: {
    pagesCrawled: metrics.pages, assetsDiscovered: metrics.assets,
    ...(measured === null ? {} : { durationMs: measured }), ...(terminal ? { status: terminal } : {}),
  } });
}

export const getSites = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as any).account.id;
    const page = Math.max(1, Number.parseInt(String(req.query.page)) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(String(req.query.limit)) || 20));
    const [sites, total] = await Promise.all([
      prisma.site.findMany({ where: { ownerId: userId }, orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit, take: limit,
        include: { crawls: { orderBy: { createdAt: 'desc' }, take: 1 }, entities: true } }),
      prisma.site.count({ where: { ownerId: userId } }),
    ]);
    const formatted = await Promise.all(sites.map(async site => {
      const crawl = site.crawls[0];
      const worker = await loadWorker(crawl);
      await synchronize(crawl, worker);
      const metrics = workerMetrics(worker || {}, crawl, site.entities);
      return { ...site, ...metrics, status: worker?.status?.toUpperCase() || crawl?.status || site.status,
        lastRun: crawl?.createdAt || site.createdAt, hasArtifacts: Boolean(worker?.generated_artifacts?.backend) };
    }));
    res.json({ sites: formatted, total });
  } catch (error) { next(error); }
};

export const getSiteById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).account;
    const site = await prisma.site.findUnique({ where: { id: String(req.params.id) },
      include: { crawls: { orderBy: { createdAt: 'desc' } }, entities: { include: { fields: true } } } });
    if (!site) return res.status(404).json({ error: 'Site not found' });
    if (site.ownerId !== user.id && user.role !== 'ADMIN') return res.status(403).json({ error: 'Forbidden' });
    const crawl = site.crawls[0];
    const worker = await loadWorker(crawl);
    await synchronize(crawl, worker);
    const entities = worker?.schema_proposal?.entities || site.entities;
    res.json({ site: { ...site, entities, status: worker?.status?.toUpperCase() || crawl?.status || site.status,
      hasArtifacts: Boolean(worker?.generated_artifacts?.backend),
      workerAvailable: Boolean(worker), traceEvents: worker?.trace_events || [],
      validation: worker?.validation_report || null },
      stats: workerMetrics(worker || {}, crawl, entities) });
  } catch (error) { next(error); }
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

    // Conversion allowances are reserved atomically when a job starts.

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
    if (site.ownerId !== userId && (req as any).account.role !== 'ADMIN') return res.status(403).json({ error: 'Forbidden' });

    await prisma.$transaction(async tx => {
      await tx.user.update({ where: { id: site.ownerId }, data: { updatedAt: new Date() } });
      const crawls = await tx.crawl.findMany({ where: { siteId: id }, select: { id: true } });
      const recorded = await tx.auditLog.findMany({ where: { action: 'conversion.started',
        targetId: { in: crawls.map(crawl => crawl.id) } }, select: { targetId: true } });
      const known = new Set(recorded.map(row => row.targetId));
      for (const crawl of crawls.filter(row => !known.has(row.id))) {
        await tx.auditLog.create({ data: { actorUserId: site.ownerId, action: 'conversion.started',
          targetType: 'crawl', targetId: crawl.id, ipHash: 'not-recorded' } });
      }
      await tx.site.delete({ where: { id } });
    });
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
