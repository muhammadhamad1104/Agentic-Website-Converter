import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import ProgressPanel from './ProgressPanel';
import StatusRecovery from './StatusRecovery';
import { useJobPolling, useStageElapsed } from '../useJobPolling';
import { appendEntries, crawlFinished, entry, failureDetail, jobFailed, traceEntries, type ActivityEntry } from '../workflow';

const nodes = new Set(['crawl_site', 'sitemap_gate']);
export default function Step3Crawl({ onNext, jobId }: { onNext: () => void; jobId?: string | null }) {
  const [status, setStatus] = useState('running');
  const [logs, setLogs] = useState<ActivityEntry[]>([]);
  const [telemetry, setTelemetry] = useState({ pages: 0, assets: 0, node: '--' });
  const elapsed = useStageElapsed(status === 'running');
  const { error, refresh } = useJobPolling(jobId, job => {
    const worker = job.workerJob;
    const artifacts = worker?.crawl_artifacts || {};
    const crawlTraces = (worker?.trace_events || []).filter((trace: any) => nodes.has(trace.node));
    setTelemetry({
      pages: Math.max(job.pagesCrawled || 0, artifacts.totals?.pages_crawled || 0, artifacts.pages?.length || 0),
      assets: Math.max(job.assetsDiscovered || 0, artifacts.totals?.assets_downloaded || 0,
        Array.isArray(artifacts.assets) ? artifacts.assets.length : Object.keys(artifacts.assets || {}).length),
      node: crawlTraces[crawlTraces.length - 1]?.node || worker?.status || job.status,
    });
    const failed = jobFailed(job);
    const done = crawlFinished(job);
    setStatus(failed ? 'failed' : done ? 'complete' : 'running');
    setLogs(previous => appendEntries(previous, [...traceEntries(job, nodes), entry(failed ? failureDetail(job) : done ? 'Website capture finished.' : `Capture status: ${worker?.status || job.status}`, failed ? 'warn' : done ? 'success' : 'info')]));
    return failed || done;
  });
  return <>
    <ProgressPanel status={error ? 'paused' : status} elapsed={elapsed} logs={logs} metrics={[{ label: 'Captured pages', value: telemetry.pages }, { label: 'Captured assets', value: telemetry.assets }, { label: 'Worker stage', value: telemetry.node }]} />
    <StatusRecovery error={error} stopped={status === 'failed'} refresh={refresh} jobId={jobId} />
    <div className="step-actions"><button className="btn btn-primary" disabled={status !== 'complete' || !!error} onClick={onNext}>Proceed to Schema Analysis<ArrowRight size={16} /></button></div>
  </>;
}
