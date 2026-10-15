import { useRef, useState } from 'react';
import { ArrowRight, RefreshCw } from 'lucide-react';
import ProgressPanel from './ProgressPanel';
import StatusRecovery from './StatusRecovery';
import { useJobStore } from '../../../../store/jobStore';
import { useJobPolling, useStageElapsed } from '../useJobPolling';
import { appendEntries, entitiesOf, entry, failureDetail, jobFailed, schemaOf, schemaReady, traceEntries, workerStatus, type ActivityEntry } from '../workflow';

const nodes = new Set(['extract_content', 'infer_candidates', 'infer_schema', 'schema_review_gate', 'engine.infer_schema_stage']);
export default function Step4Schema({ onNext, jobId }: { onNext: () => void; jobId?: string | null }) {
  const { inferSchema } = useJobStore();
  const attempted = useRef(false);
  const [status, setStatus] = useState('running');
  const [startError, setStartError] = useState('');
  const [logs, setLogs] = useState<ActivityEntry[]>([]);
  const [metrics, setMetrics] = useState({ entities: 0, fields: 0, batches: '--' });
  const elapsed = useStageElapsed(status === 'running' && !startError);
  const { error, refresh } = useJobPolling(jobId, async job => {
    const progress = job.workerJob?.schema_quality_report?.inference_progress || {};
    const entities = entitiesOf(schemaOf(job));
    const fields = entities.reduce((count, entity) => count + Object.keys(entity.fields || entity.properties || {}).length, 0);
    setMetrics({ entities: entities.length || progress.entity_count || 0, fields: fields || progress.field_count || 0,
      batches: progress.total_batches ? `${progress.completed_batches || 0} / ${progress.total_batches}` : '--' });
    const failed = jobFailed(job);
    const done = schemaReady(job);
    setStatus(failed ? 'failed' : done ? 'complete' : 'running');
    setLogs(previous => appendEntries(previous, [...traceEntries(job, nodes), ...(failed ? [entry(failureDetail(job), 'warn')] :
      done ? [entry(`Schema inference completed! ${entities.length} model(s) ready for review.`, 'success')] : [])]));
    if (failed || done) { setStartError(''); return true; }
    if (!attempted.current && ['crawled', 'extracted'].includes(workerStatus(job)) && job.status !== 'INFERRING_SCHEMA') {
      attempted.current = true;
      try { await inferSchema(job.id); setStartError(''); }
      catch { setStartError('Unable to confirm the analysis start. Refresh status before retrying.'); }
    }
    if (workerStatus(job) === 'inferring_schema' || job.status === 'INFERRING_SCHEMA') setStartError('');
    return false;
  });
  return <>
    <ProgressPanel status={error || startError ? 'paused' : status} elapsed={elapsed} logs={logs} metrics={[{ label: 'Content models', value: metrics.entities }, { label: 'Fields', value: metrics.fields }, { label: 'Evidence batches', value: metrics.batches }]} />
    <StatusRecovery error={error} stopped={status === 'failed'} refresh={refresh} jobId={jobId} />
    {startError && <div className="notice-box" role="alert">{startError}<button className="btn btn-ghost btn-sm" onClick={() => { attempted.current = false; setStartError(''); refresh(); }}><RefreshCw size={14} />Retry analysis</button></div>}
    <div className="step-actions"><button className="btn btn-primary" disabled={status !== 'complete' || !!error} onClick={onNext}>Review schema<ArrowRight size={16} /></button></div>
  </>;
}
