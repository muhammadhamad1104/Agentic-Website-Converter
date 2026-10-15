import { useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Loader2, ShieldCheck } from 'lucide-react';
import { LoadError } from '../../../components/Workspace/Workspace';
import { useJobStore } from '../../../../store/jobStore';
import { useResource, type AccountSummary } from '../../../../hooks/useResource';
import { Link } from 'react-router-dom';

const options = [
  { name: 'Quick scan', depth: 1, pages: 20 },
  { name: 'Deep scan', depth: 2, pages: 50 },
  { name: 'Full website', depth: 3, pages: 0 },
];
export default function Step2Config({ onNext, onBack, setJobId, targetUrl, siteId, sourceType = 'URL' }: {
  onNext: () => void; onBack: () => void; setJobId: (id: string) => void; targetUrl?: string; siteId?: string | null;
  sourceType?: 'URL' | 'ZIP';
}) {
  const [level, setLevel] = useState(2);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState('');
  const account = useResource<AccountSummary>('/account/summary');
  const { createJob } = useJobStore();
  const archive = sourceType === 'ZIP';
  const selected = archive ? options[2] : options[level];
  const start = async () => {
    if (submitting.current || !targetUrl || (archive && !siteId) || !account.data?.plan.canConvert) return;
    submitting.current = true;
    setBusy(true); setError('');
    try {
      const job = await createJob({ siteId: siteId || undefined, ...(archive ? {} : { url: targetUrl }), crawlDepth: selected.depth,
        fullSite: selected.pages === 0, maxPages: selected.pages, maxAssets: 0, extractImages: true, inferRelations: true });
      setJobId(job.id); onNext();
    } catch (problem: any) { setError(problem.response?.data?.error || problem.message || 'Unable to start conversion.'); }
    finally { submitting.current = false; setBusy(false); }
  };
  return <>
    <section className="step-content"><div className="conversion-settings"><div>
      {archive ? <div className="archive-scope"><ShieldCheck size={24} strokeWidth={1.3} /><div><strong>Complete archive</strong><span>{targetUrl}</span></div></div> : <fieldset className="capture-options"><legend>Crawl scope</legend><div className="segmented-control">{options.map((option, index) =>
        <label key={option.name} className={level === index ? 'selected' : ''}><input type="radio" name="scope" value={index} aria-label={option.name} checked={level === index} onChange={() => setLevel(index)} disabled={busy} /><strong>{option.name}</strong><small>{option.pages ? option.pages + ' pages' : 'No page cap'}</small></label>)}</div></fieldset>}
      {account.data && <div className="conversion-allowance"><ShieldCheck size={21} strokeWidth={1.4} /><div><p>{account.data.plan.remaining === null ? 'Unlimited conversions' : account.data.plan.remaining + ' conversions remaining'}</p><small>{account.data.plan.name} membership</small></div></div>}
      {account.data && !account.data.plan.canConvert && <div className="notice-box">Starter allowance used. <Link to="/checkout">Upgrade to Pro</Link></div>}
      {account.error && <LoadError error={account.error} retry={account.refresh} />}
      {error && <p className="notice-box error" role="alert">{error}</p>}
      </div><div className="capture-manifest"><h3>Capture manifest</h3><dl className="detail-list"><div><dt>{archive ? 'HTML pages' : 'Page limit'}</dt><dd>{archive ? 'All included' : selected.pages || 'No cap'}</dd></div><div><dt>{archive ? 'Source' : 'Link depth'}</dt><dd>{archive ? 'Uploaded ZIP' : selected.pages ? selected.depth : 'All discoverable pages'}</dd></div><div><dt>Images & media</dt><dd>Included</dd></div><div><dt>{archive ? 'Folders' : 'Asset limit'}</dt><dd>{archive ? 'Preserved' : 'No cap'}</dd></div></dl></div></div>
    </section><div className="step-actions"><button className="btn btn-secondary" disabled={busy} onClick={onBack}><ArrowLeft size={16} />Back</button>
      <button className="btn btn-primary" disabled={busy || !targetUrl || (archive && !siteId) || !account.data?.plan.canConvert} onClick={start}>{busy ? <Loader2 className="animate-spin" size={16} /> : <ArrowRight size={16} />}{busy ? 'Starting...' : 'Start conversion'}</button></div></>;
}
