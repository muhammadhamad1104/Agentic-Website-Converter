import type { ConversionJob } from '../../../types/job';

export const workerStatus = (job: ConversionJob) => String(job.workerJob?.status || '').toLowerCase();
export const jobFailed = (job: ConversionJob) =>
  ['failed', 'cancelled', 'error'].includes(workerStatus(job)) || ['FAILED', 'CANCELLED'].includes(job.status);
export const schemaOf = (job: ConversionJob) => job.workerJob?.schema_proposal || job.schemaProposal;
export const entitiesOf = (schema: any): any[] => {
  const entities = schema?.entities || schema?.models;
  return Array.isArray(entities) ? entities : [];
};
export const artifactsOf = (job: ConversionJob) => job.workerJob?.generated_artifacts || job.generatedArtifacts || {};
export const hasExportArtifacts = (job: ConversionJob) => Object.keys(artifactsOf(job)).length > 0;
export const generationFinished = (job: ConversionJob) =>
  ['validated', 'completed', 'ready', 'exported', 'package_approved'].includes(workerStatus(job));
export const generationStarted = (job: ConversionJob) =>
  ['approved', 'schema_approved', 'generating', 'generated', 'validating', 'packaging'].includes(workerStatus(job)) ||
  generationFinished(job) || ['GENERATING', 'VALIDATING', 'PACKAGING'].includes(job.status);
export const schemaReady = (job: ConversionJob) => !jobFailed(job) &&
  entitiesOf(schemaOf(job)).length > 0 && job.workerJob?.schema_decision !== 'rejected' &&
  job.schemaDecision !== 'rejected' && (job.workerJob?.schema_quality_report?.quality_gate == null || job.workerJob.schema_quality_report.quality_gate === 'open') &&
  (['awaiting_approval', 'schema_proposed'].includes(workerStatus(job)) || generationStarted(job));
export const crawlFinished = (job: ConversionJob) => !jobFailed(job) && (
  ['crawled', 'extracted', 'inferring_schema', 'awaiting_approval', 'schema_proposed'].includes(workerStatus(job)) ||
  generationStarted(job) || ['CRAWLED', 'INFERRING_SCHEMA', 'AWAITING_APPROVAL', 'COMPLETED', 'READY', 'DONE'].includes(job.status));
export const resumeStep = (job: ConversionJob) => {
  if (jobFailed(job)) {
    if (hasExportArtifacts(job)) return 6;
    return job.workerJob?.schema_decision === 'approved' ? 6 :
      job.workerJob?.trace_events?.some((trace: any) => /infer_schema|infer_candidates|extract_content/.test(trace.node || '')) ? 4 : 3;
  }
  if (generationStarted(job)) return 6;
  if (schemaReady(job)) return 5;
  if (crawlFinished(job)) return 4;
  return 3;
};

export type ActivityEntry = { timestamp: string; level: 'info' | 'success' | 'warn' | 'node'; text: string };
export const entry = (text: string, level: ActivityEntry['level'] = 'info'): ActivityEntry =>
  ({ timestamp: new Date().toLocaleTimeString(), level, text });
export const traceEntries = (job: ConversionJob, nodes: Set<string>) =>
  (job.workerJob?.trace_events || job.traceEvents || [])
    .filter((trace: any) => nodes.has(trace.node))
    .map((trace: any) => entry(`[${trace.node}] ${trace.message || trace.output_status || trace.status || 'Event received'}`,
      trace.output_status === 'failed' || trace.status === 'failed' ? 'warn' : 'node'));
export const appendEntries = (previous: ActivityEntry[], added: ActivityEntry[]) => {
  const seen = new Set(previous.map(log => log.text));
  return [...previous, ...added.filter(log => { if (seen.has(log.text)) return false; seen.add(log.text); return true; })].slice(-500);
};
export const failureDetail = (job: ConversionJob) =>
  [...(job.workerJob?.errors || job.errors || []), ...(job.workerJob?.validation_report?.issues || [])
    .filter((issue: any) => issue.severity === 'blocker').map((issue: any) => issue.message)].join(' ') || 'The worker stopped. Refresh status to check for updates.';
