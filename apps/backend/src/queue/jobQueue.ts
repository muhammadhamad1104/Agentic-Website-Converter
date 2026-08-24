import { Queue, Worker, Job } from 'bullmq';
import axios from 'axios';
import { bullmqConnection } from '../config/redis';
import logger from '../utils/logger';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const conversionQueue = new Queue('conversion-jobs', {
  connection: bullmqConnection
});

const worker = new Worker('conversion-jobs', async (job: Job) => {
  const { siteId, url, extractImages, crawlDepth } = job.data;
  
  logger.info(`Processing job ${job.id} for site ${siteId} with crawl depth ${crawlDepth || 2}`);
  
  try {
    // 1. Update status to PROCESSING
    await prisma.crawl.update({
      where: { id: job.id },
      data: { status: 'PROCESSING' }
    });
    await prisma.site.update({
      where: { id: siteId },
      data: { status: 'ANALYZING' }
    });
    
    // 2. Call FastAPI Worker
    const workerUrl = process.env.WORKER_API_URL || 'http://localhost:8000';
    const response = await axios.post(`${workerUrl}/api/jobs`, {
      url: url,
      crawl_depth: Number(crawlDepth) || 2,
      extract_images: extractImages ?? true
    });
    
    const workerJobId = response.data.job_id;
    
    await prisma.crawl.update({
      where: { id: job.id },
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

    while (attempts < 60) {
      await delay(2000);
      attempts++;
      try {
        const pollRes = await axios.get(`${workerUrl}/api/jobs/${workerJobId}`);
        workerJobData = pollRes.data.job || {};
        workerStatus = (pollRes.data.status || workerJobData.status || '').toLowerCase();
        
        if (['crawled', 'awaiting_approval', 'validated', 'completed', 'failed', 'error'].includes(workerStatus)) {
          break;
        }
      } catch (pollErr: any) {
        logger.warn(`Polling worker job ${workerJobId} attempt ${attempts} warning: ${pollErr.message}`);
      }
    }

    // 4. Save results to DB
    const crawlArtifacts = workerJobData?.crawl_artifacts || {};
    const pagesCrawled = crawlArtifacts?.totals?.pages_crawled || workerJobData?.crawled_pages?.length || (workerJobData?.crawl_artifacts?.pages?.length || 1);
    const getLength = (obj: any) => Array.isArray(obj) ? obj.length : (obj && typeof obj === 'object' ? Object.keys(obj).length : 0);
    const assetsDiscovered = crawlArtifacts?.totals?.assets_downloaded || workerJobData?.counts_by_kind?.assets || crawlArtifacts?.asset_count || getLength(crawlArtifacts?.assets) || 0;
    
    let dbStatus = 'PROCESSING';
    if (workerStatus === 'crawled') {
      dbStatus = 'CRAWLED';
    } else if (workerStatus === 'awaiting_approval') {
      dbStatus = 'AWAITING_APPROVAL';
    } else if (workerStatus === 'failed' || workerStatus === 'error') {
      dbStatus = 'FAILED';
    } else if (['validated', 'completed', 'ready'].includes(workerStatus)) {
      dbStatus = 'COMPLETED';
    }

    await prisma.crawl.update({
      where: { id: job.id },
      data: {
        status: dbStatus,
        pagesCrawled,
        assetsDiscovered,
        logRef: workerJobId,
      }
    });

    // Extract inferred schema entities and store in PostgreSQL
    const schemaProposal = workerJobData?.schema_proposal || {};
    const entities = schemaProposal?.entities || schemaProposal?.models || [];
    
    if (!Array.isArray(entities) || entities.length === 0) {
      logger.warn(`Job ${job.id}: No schema entities inferred by AI worker.`);
    }

    if (Array.isArray(entities)) {
      for (const entity of entities) {
        const entityName = entity.name || 'Entity';
        const entitySlug = entityName.toLowerCase();
        
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
    await prisma.conversionPlan.create({
      data: {
        siteId,
        entities: entities as any,
        dbSchema: workerJobData?.generated_artifacts?.prisma_schema || '// Auto-generated Prisma Schema',
        frontendViews: workerJobData?.generated_artifacts?.react_views || [],
        backendRoutes: workerJobData?.generated_artifacts?.express_routes || [],
        migrations: []
      }
    });

    await prisma.site.update({
      where: { id: siteId },
      data: { status: 'READY', previewUrl: url }
    });

    logger.info(`Job ${job.id} fully completed and persisted to PostgreSQL!`);
    return { success: true, workerJobId };
  } catch (error: any) {
    logger.error(`Error processing job ${job.id}: ${error.message}`);
    
    await prisma.crawl.update({
      where: { id: job.id },
      data: { status: 'FAILED' }
    });
    await prisma.site.update({
      where: { id: siteId },
      data: { status: 'FAILED' }
    });
    
    throw error;
  }
}, {
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

