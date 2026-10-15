import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Check, CheckCircle2, Copy, Loader2, Terminal, TriangleAlert } from 'lucide-react';
import { Metrics } from '../../../components/Workspace/Workspace';

export function generatedFileCount(artifacts: unknown): number {
  const names = new Set<string>();
  function visit(value: any) {
    if (!value || typeof value !== 'object') return;
    if (typeof value.filename === 'string' && typeof value.code === 'string') names.add(value.filename);
    else Object.values(value).forEach(visit);
  }
  visit(artifacts);
  return names.size;
}

export default function ProgressPanel({ status, elapsed, metrics, logs }: {
  status: string; elapsed: string; metrics: { label: string; value: string | number }[];
  logs: { timestamp: string; level: string; text: string }[];
}) {
  const console = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (following && console.current) console.current.scrollTop = console.current.scrollHeight;
    setCopied(false);
  }, [logs.length, following]);
  const running = status === 'running';
  const warning = status === 'failed' || status === 'warnings' || status === 'paused';
  const StatusIcon = running ? Loader2 : warning ? TriangleAlert : CheckCircle2;
  return <section className="step-content">
    <div style={{ '--metrics': metrics.length + 1 } as CSSProperties}><Metrics items={[...metrics.map(metric => ({
      ...metric, value: metric.label === 'Worker stage' ? <code>{metric.value}</code> : metric.value,
    })), { label: 'Time on this step', value: elapsed }]} /></div>
    <div className="activity-heading"><h3><Terminal size={15} />Worker activity</h3><div className="activity-controls">
      <label><input type="checkbox" checked={following} onChange={event => setFollowing(event.target.checked)} />Follow live</label>
      <button className="icon-control" type="button" disabled={!logs.length} aria-label={copied ? 'Activity copied' : 'Copy worker activity'} title={copied ? 'Activity copied' : 'Copy worker activity'} onClick={async () => {
        setError('');
        try { await navigator.clipboard.writeText(logs.map(entry => entry.timestamp + ' [' + entry.level + '] ' + entry.text).join('\n')); setCopied(true); }
        catch { setError('Activity could not be copied. Your browser may require clipboard permission.'); }
      }}>{copied ? <Check size={14} /> : <Copy size={14} />}</button>
    </div></div>
    {running && <div className="loading-line" role="status" aria-label="Worker running" />}
    <div className="worker-console" ref={console} role="log" aria-label="Worker activity" aria-live="polite" aria-relevant="additions" tabIndex={0}
      onScroll={() => { const element = console.current; if (element && element.scrollHeight - element.scrollTop - element.clientHeight > 48) setFollowing(false); }}>
      {logs.length ? logs.map((entry, index) => <div key={index} className={'worker-line ' + entry.level}><time>{entry.timestamp}</time><span>{entry.text}</span></div>) : <p className="worker-console-empty">Awaiting worker events.</p>}
    </div>
    <div className="activity-status"><StatusIcon size={14} className={running ? 'animate-spin' : ''} />
      <span className={'status-label ' + (status === 'failed' ? 'failed' : running ? 'active' : '')}>{status === 'warnings' ? 'FILES AVAILABLE' : status.toUpperCase()}</span>
      <span>{logs.length} {logs.length === 1 ? 'event' : 'events'}</span>
    </div>
    {error && <p className="notice-box error" role="alert">{error}</p>}
  </section>;
}
