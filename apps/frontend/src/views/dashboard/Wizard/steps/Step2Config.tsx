import { useState } from 'react';
import { ArrowLeft, ArrowRight, Loader2, ShieldCheck } from 'lucide-react';
import { LoadError } from '../../../components/Workspace/Workspace';
import api from '../../../../services/api';
import { useResource, type AccountSummary } from '../../../../hooks/useResource';
import { Link } from 'react-router-dom';

const options = [
  { name: 'Quick scan', depth: 1, pages: 20 },
  { name: 'Deep scan', depth: 2, pages: 50 },
  { name: 'Full website', depth: 3, pages: 0 },
];
export default function Step2Config({ onNext, onBack, setJobId, targetUrl, siteId }: {
  onNext: () => void; onBack: () => void; setJobId: (id: string) => void; targetUrl?: string; siteId?: string | null;
}) {
  const [level, setLevel] = useState(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const account = useResource<AccountSummary>('/account/summary');
  const selected = options[level];
  const start = async () => {
    setBusy(true); setError('');
    try {
      const result = await api.post('/jobs', { siteId, url: targetUrl, crawlDepth: selected.depth,
        fullSite: selected.pages === 0, maxPages: selected.pages, maxAssets: 0, extractImages: true, inferRelations: true });
      if (!result.data.job?.id) throw new Error('Job ID was not returned.');
      setJobId(result.data.job.id); onNext();
    } catch (problem: any) { setError(problem.response?.data?.error || problem.message || 'Unable to start conversion.'); }
    finally { setBusy(false); }
  };
  return <>
    <section className="step-content"><div className="conversion-settings"><div>
      <fieldset className="capture-options"><legend>Crawl scope</legend><div className="segmented-control">{options.map((option, index) =>
        <label key={option.name} className={level === index ? 'selected' : ''}><input type="radio" name="scope" value={index} aria-label={option.name} checked={level === index} onChange={() => setLevel(index)} disabled={busy} /><strong>{option.name}</strong><small>{option.pages ? option.pages + ' pages' : 'No page cap'}</small></label>)}</div></fieldset>
      {account.data && <div className="conversion-allowance"><ShieldCheck size={21} strokeWidth={1.4} /><div><p>{account.data.plan.remaining === null ? 'Unlimited conversions' : account.data.plan.remaining + ' conversions remaining'}</p><small>{account.data.plan.name} membership</small></div></div>}
      {account.data && !account.data.plan.canConvert && <div className="notice-box">Starter allowance used. <Link to="/checkout">Upgrade to Pro</Link></div>}
      {account.error && <LoadError error={account.error} retry={account.refresh} />}
      {error && <p className="notice-box error" role="alert">{error}</p>}
      </div><div className="capture-manifest"><h3>Capture manifest</h3><dl className="detail-list"><div><dt>Page limit</dt><dd>{selected.pages || 'No cap'}</dd></div><div><dt>Link depth</dt><dd>{selected.pages ? selected.depth : 'All discoverable pages'}</dd></div><div><dt>Images & media</dt><dd>Included</dd></div><div><dt>Asset limit</dt><dd>No cap</dd></div></dl></div></div>
    </section><div className="step-actions"><button className="btn btn-secondary" disabled={busy} onClick={onBack}><ArrowLeft size={16} />Back</button>
      <button className="btn btn-primary" disabled={busy || !targetUrl || !account.data?.plan.canConvert} onClick={start}>{busy ? <Loader2 className="animate-spin" size={16} /> : <ArrowRight size={16} />}{busy ? 'Starting...' : 'Start conversion'}</button></div></>;
}
