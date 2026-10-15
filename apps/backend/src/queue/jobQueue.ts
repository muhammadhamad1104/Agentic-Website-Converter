import { Queue, Worker, Job } from 'bullmq';
import axios from 'axios';
import { bullmqConnection } from '../config/redis';
import logger from '../utils/logger';
import { PrismaClient } from '@prisma/client';
import { sourceHeaders } from '../services/sourceUploads';

const prisma = new PrismaClient();
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const conversionQueue = new Queue('conversion-jobs', {
  connection: bullmqConnection
});

export const processConversionJob = async (job: Job) => {
  const { siteId, url, sourceUploadId, sourceOwnerId, extractImages, crawlDepth, fullSite, maxPages, maxAssets } = job.data;
  const crawlId = job.data.jobId || job.id;
  
  logger.info(`Processing job ${job.id} for site ${siteId} with crawl depth ${crawlDepth || 2}`);
  
  try {
    const crawl = await prisma.crawl.findUnique({ where: { id: crawlId } });
    if (!crawl) throw new Error('Conversion no longer exists');
    // 1. Update status to PROCESSING
    await prisma.crawl.update({
      where: { id: crawlId },
      data: { status: 'PROCESSING' }
    });
    await prisma.site.update({
      where: { id: siteId },
      data: { status: 'ANALYZING' }
    });
    
    // 2. Call FastAPI Worker
    const workerUrl = process.env.WORKER_URL || process.env.WORKER_API_URL || 'http://localhost:8000';
    let workerJobId = crawl.logRef;
    if (!workerJobId) {
      const response = await axios.post(`${workerUrl}/api/jobs`, {
      ...(sourceUploadId ? { source_upload_id: sourceUploadId } : { url }),
      crawl_depth: crawlDepth ?? 3,
      full_site: fullSite ?? true,
      max_pages: maxPages ?? 0,
      max_assets: maxAssets ?? 0,
      extract_images: extractImages ?? true
      }, { timeout: 15000, headers: { ...(sourceUploadId ? sourceHeaders(sourceOwnerId) : {}), 'X-Conversion-Id': String(crawlId) } });
      workerJobId = response.data.job_id;
      if (!workerJobId) throw new Error('Worker returned no job ID');
    }
    
    await prisma.crawl.update({
      where: { id: crawlId },
      data: { 
        logRef: workerJobId,
        status: 'PROCESSING'
      }
    });
    
    logger.info(`Job ${job.id} handed off to Python Worker with worker ID ${workerJobId}`);
    
    // 3. Poll Python Worker until workflow finishes
    let attempts = 0;
    let workerStatus = 'pending';
    let workerJobData: any = null;

    let consecutiveErrors = 0;
    const pollStarted = Date.now();
    while (true) {
      if (Date.now() - pollStarted >= 24 * 60 * 60 * 1000)
        throw new Error('Worker monitoring timed out. Retry to reconnect to the saved conversion.');
      await delay(2000);
      attempts++;
      try {
        const pollRes = await axios.get(`${workerUrl}/api/jobs/${workerJobId}`, { timeout: 10000 });
        workerJobData = pollRes.data.job || {};
        workerStatus = (pollRes.data.status || workerJobData.status || '').toLowerCase();
        if (!workerStatus) throw new Error('Worker returned no job state');
        consecutiveErrors = 0;
        
        if (['crawled', 'extracted', 'inferring_schema', 'schema_proposed', 'awaiting_approval', 'approved', 'generating',
          'generated', 'validated', 'completed', 'ready', 'exported', 'package_approved', 'failed', 'error', 'cancelled'].includes(workerStatus)) {
          break;
        }
      } catch (pollErr: any) {
        logger.warn(`Polling worker job ${workerJobId} attempt ${attempts} warning: ${pollErr.message}`);
        if (pollErr.response?.status === 404) throw new Error('Worker job is missing; saved conversion could not be recovered');
        if (++consecutiveErrors >= 15) throw new Error('Worker unavailable while polling conversion');
      }
    }

    // 4. Save results to DB
    const crawlArtifacts = workerJobData?.crawl_artifacts || {};
    const pagesCrawled = crawlArtifacts?.totals?.pages_crawled || workerJobData?.crawled_pages?.length || (workerJobData?.crawl_artifacts?.pages?.length || 0);
    const getLength = (obj: any) => Array.isArray(obj) ? obj.length : (obj && typeof obj === 'object' ? Object.keys(obj).length : 0);
    const assetsDiscovered = crawlArtifacts?.totals?.assets_downloaded || workerJobData?.counts_by_kind?.assets || crawlArtifacts?.asset_count || getLength(crawlArtifacts?.assets) || 0;
    
    let dbStatus = 'PROCESSING';
    if (['crawled', 'extracted'].includes(workerStatus)) {
      dbStatus = 'CRAWLED';
    } else if (['awaiting_approval', 'schema_proposed'].includes(workerStatus)) {
      dbStatus = 'AWAITING_APPROVAL';
    } else if (workerStatus === 'inferring_schema') {
      dbStatus = 'INFERRING_SCHEMA';
    } else if (['approved', 'generating', 'generated'].includes(workerStatus)) {
      dbStatus = 'GENERATING';
    } else if (['failed', 'error', 'cancelled'].includes(workerStatus)) {
      dbStatus = 'FAILED';
    } else if (['validated', 'completed', 'ready', 'exported', 'package_approved'].includes(workerStatus)) {
      dbStatus = 'COMPLETED';
    }

    await prisma.crawl.update({
      where: { id: crawlId },
      data: {
        status: dbStatus,
        pagesCrawled,
        assetsDiscovered,
        logRef: workerJobId,
        errors: dbStatus === 'FAILED' ? workerJobData?.errors || ['Worker conversion failed'] : [],
      }
    });

    // Extract inferred schema entities and store in PostgreSQL
    const schemaProposal = workerJobData?.schema_proposal || {};
    const entities = schemaProposal?.entities || schemaProposal?.models || [];
    
    if (!Array.isArray(entities) || entities.length === 0) {
      logger.warn(`Job ${job.id}: No schema entities inferred by AI worker.`);
    }

    if (dbStatus !== 'FAILED' && Array.isArray(entities)) {
      for (const entity of entities) {
        const entityName = entity.name || 'Entity';
        const entitySlug = entityName.toLowerCase();
        const existing = await prisma.entityDefinition.findFirst({ where: { siteId, slug: entitySlug } });
        if (existing) continue;
        
        const dbEntity = await prisma.entityDefinition.create({
          data: {
            siteId,
            name: entityName,
            slug: entitySlug,
            description: entity.description || `Inferred ${entityName} data model`,
            status: 'active'
          }
        });

        const fields = entity.fields || entity.properties || [];
        if (Array.isArray(fields)) {
          let order = 1;
          for (const field of fields) {
            const fieldName = typeof field === 'string' ? field : field.name || `field_${order}`;
            const fieldType = typeof field === 'string' ? 'String' : field.type || 'String';
            await prisma.fieldDefinition.create({
              data: {
                entityId: dbEntity.id,
                name: fieldName,
                slug: fieldName.toLowerCase(),
                type: fieldType,
                order: order++
              }
            });
          }
        }
      }
    }

    // Save ConversionPlan
    if (dbStatus !== 'FAILED' && Array.isArray(entities) && entities.length &&
        !await prisma.conversionPlan.findFirst({ where: { siteId, notes: `worker:${workerJobId}` } })) {
      await prisma.conversionPlan.create({
      data: {
        siteId,
        notes: `worker:${workerJobId}`,
        entities: entities as any,
        dbSchema: workerJobData?.generated_artifacts?.prisma_schema || '// Auto-generated Prisma Schema',
        frontendViews: workerJobData?.generated_artifacts?.react_views || [],
        backendRoutes: workerJobData?.generated_artifacts?.express_routes || [],
        migrations: []
      }
      });
    }

    await prisma.site.update({
      where: { id: siteId },
      data: { status: dbStatus === 'COMPLETED' ? 'READY' : dbStatus === 'FAILED' ? 'FAILED' : dbStatus === 'GENERATING' ? 'BUILDING' : 'ANALYZING' }
    });

    logger.info(`Job ${job.id} reached ${dbStatus} and persisted to PostgreSQL`);
    return { success: dbStatus !== 'FAILED', workerJobId };
  } catch (error: any) {
    logger.error(`Error processing job ${job.id}: ${error.message}`);
    
    await prisma.crawl.update({
      where: { id: crawlId },
      data: { status: 'FAILED', errors: [error.message || 'Conversion worker failed'] }
    });
    await prisma.site.update({
      where: { id: siteId },
      data: { status: 'FAILED' }
    });
    
    throw error;
  }
};

const worker = new Worker('conversion-jobs', processConversionJob, {
  connection: bullmqConnection
});

worker.on('completed', (job: Job) => {
  logger.info(`Job ${job.id} has completed!`);
});

worker.on('failed', (job: Job | undefined, err: Error) => {
  if (job) {
    logger.error(`Job ${job.id} has failed with ${err.message}`);
  }
});
