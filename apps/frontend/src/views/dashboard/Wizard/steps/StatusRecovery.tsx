import { RefreshCw } from 'lucide-react';
import { useRef, useState } from 'react';
import { useJobStore } from '../../../../store/jobStore';

export default function StatusRecovery({ error, stopped, refresh, jobId }: { error: string; stopped?: boolean; refresh: () => void; jobId?: string | null }) {
  const [retryError, setRetryError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const { runJob } = useJobStore();
  const resume = async () => {
    if (!jobId || lock.current) return;
    lock.current = true; setBusy(true); setRetryError('');
    try { await runJob(jobId); refresh(); }
    catch (problem: any) { setRetryError(problem.response?.data?.error || 'Unable to resume. Refresh status and try again.'); }
    finally { lock.current = false; setBusy(false); }
  };
  if (!error && !stopped) return null;
  return <div className="notice-box" role={error ? 'alert' : undefined}>
    {error || retryError}<button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={refresh}><RefreshCw size={14} />Refresh status</button>
    {stopped && jobId && <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={resume}><RefreshCw size={14} />{busy ? 'Resuming...' : 'Resume conversion'}</button>}
  </div>;
}
