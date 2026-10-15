import { useState } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import ProgressPanel, { generatedFileCount } from './ProgressPanel';
import StatusRecovery from './StatusRecovery';
import { useJobPolling, useStageElapsed } from '../useJobPolling';
import { appendEntries, artifactsOf, entitiesOf, entry, failureDetail, generationFinished, hasExportArtifacts, jobFailed, schemaOf, traceEntries, type ActivityEntry } from '../workflow';

const nodes = new Set(['generate_backend', 'generate_frontend', 'generate_admin', 'validate_consistency', 'validate_build_smoke', 'validation_review_gate', 'end_package_approved']);
export default function Step6Generate({ onNext, jobId }: { onNext: () => void; jobId?: string | null }) {
  const [status, setStatus] = useState('running');
  const [logs, setLogs] = useState<ActivityEntry[]>([]);
  const [metrics, setMetrics] = useState({ models: 0, backend: 0, frontend: 0 });
  const elapsed = useStageElapsed(status === 'running');
  const { error, refresh } = useJobPolling(jobId, job => {
    const artifacts = artifactsOf(job);
    setMetrics({ models: entitiesOf(schemaOf(job)).length, backend: generatedFileCount(artifacts.backend), frontend: generatedFileCount(artifacts.frontend) });
    const report = job.workerJob?.validation_report || job.validationReport || {};
    const failed = jobFailed(job);
    const done = generationFinished(job);
    const stopped = failed || done;
    const validated = !failed && report.validation_gate === 'open' && report.build_status === 'passed';
    const nextStatus = stopped ? hasExportArtifacts(job) ? validated && !report.issues?.length ? 'complete' : 'warnings' : 'failed' : 'running';
    setStatus(nextStatus);
    setLogs(previous => appendEntries(previous, [...traceEntries(job, nodes), ...(stopped ? [entry(failed ? failureDetail(job) :
      validated ? 'Generation and runtime build checks finished.' : 'Generation stopped without a confirmed runtime build. Source artifacts may be exported.', nextStatus === 'complete' ? 'success' : 'warn')] : [])]));
    return stopped;
  });
  const available = status === 'complete' || status === 'warnings';
  return <>
    <ProgressPanel status={error ? 'paused' : status} elapsed={elapsed} logs={logs} metrics={[{ label: 'Content models', value: metrics.models }, { label: 'Backend files', value: metrics.backend }, { label: 'Frontend files', value: metrics.frontend }]} />
    <StatusRecovery error={error} stopped={status === 'failed' || status === 'warnings'} refresh={refresh} jobId={jobId} />
    <div className="step-actions"><button className="btn btn-primary" disabled={!available || !!error} onClick={onNext}>{available ? <>Proceed to Download<ArrowRight size={16} /></> : status === 'running' ? <><Loader2 size={16} className="animate-spin" />Generating Code...</> : 'No files available'}</button></div>
  </>;
}
