export const TERMINAL_STATUSES = new Set(['validated', 'completed', 'ready', 'failed', 'cancelled', 'error']);

export function processingDuration(job: any): number | null {
  if (!TERMINAL_STATUSES.has(String(job.status).toLowerCase())) return null;
  const durations = (job.trace_events || []).map((event: any) => event.duration_ms)
    .filter((value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0);
  return durations.length ? Math.round(durations.reduce((sum: number, value: number) => sum + value, 0)) : null;
}

export function workerMetrics(job: any, crawl: any = {}, entities: any[] = []) {
  const source = job.generated_artifacts?.source_report || {};
  const captured = job.crawl_artifacts || {};
  return {
    pages: source.page_count ?? captured.totals?.pages_crawled ?? crawl.pagesCrawled ?? 0,
    assets: source.asset_count ?? captured.totals?.assets_downloaded ?? crawl.assetsDiscovered ?? 0,
    models: job.schema_proposal?.entities?.length ?? entities.length,
    durationMs: processingDuration(job) ?? crawl.durationMs ?? null,
    editableFields: source.editable_field_count ?? null,
  };
}
import axios from 'axios';

export async function refreshConversionMetrics(db: any, ownerId?: string) {
  const pending = await db.crawl.findMany({ where: {
    ...(ownerId ? { site: { ownerId } } : {}), logRef: { not: null },
    OR: [{ status: { notIn: ['COMPLETED', 'FAILED'] } }, { durationMs: null }],
  }, orderBy: { createdAt: 'desc' }, take: 20 });
  const worker = process.env.WORKER_URL || process.env.WORKER_API_URL || 'http://localhost:8000';
  await Promise.all(pending.map(async (crawl: any) => {
    try {
      const job = (await axios.get(worker + '/api/jobs/' + crawl.logRef, { timeout: 3000 })).data.job;
      const state = String(job.status).toLowerCase();
      const durationMs = processingDuration(job);
      const status = ['validated', 'completed', 'ready', 'exported'].includes(state) ? 'COMPLETED'
        : ['failed', 'error', 'cancelled'].includes(state) ? 'FAILED' : state.toUpperCase();
      const counts = workerMetrics(job, crawl);
      await db.crawl.update({ where: { id: crawl.id }, data: { status, pagesCrawled: counts.pages,
        assetsDiscovered: counts.assets, ...(durationMs === null ? {} : { durationMs }) } });
    } catch { /* Preserve recorded metrics if the worker is temporarily unavailable. */ }
  }));
}
