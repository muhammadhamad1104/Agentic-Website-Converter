import { useEffect, useState } from 'react';
import { ArrowRight, Globe, Loader2, CheckCircle2 } from 'lucide-react';
import { useSiteStore } from '../../../../store/siteStore';
import api from '../../../../services/api';
import ConversionVisual from './ConversionVisual';
const isValidTargetUrl = (val: string): boolean => {
  const trimmed = val.trim().toLowerCase();
  if (!trimmed || trimmed.length < 4) return false;

  const withoutProtocol = trimmed.replace(/^https?:\/\//, '');
  if (withoutProtocol === 'localhost' || withoutProtocol.startsWith('localhost:') || withoutProtocol.startsWith('127.0.0.1')) {
    return true;
  }

  // Must contain valid domain name + TLD extension (e.g. kubernetes.io or https://kubernetes.io)
  const domainPattern = /^([a-z0-9-]+\.)+[a-z]{2,}(\/.*)?$/;
  return domainPattern.test(withoutProtocol);
};


export default function Step1Input({ onNext, setTargetUrl, setSiteId }: {
  onNext: () => void; setJobId: (id: string) => void; setTargetUrl: (url: string) => void; setSiteId: (id: string) => void;
}) {
  const [url, setUrl] = useState('');
  const [verified, setVerified] = useState('');
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const { createSite } = useSiteStore();
  const valid = isValidTargetUrl(url);
  useEffect(() => {
    setVerified(''); setError('');
    if (!isValidTargetUrl(url)) { setChecking(false); return; }
    let active = true;
    const controller = new AbortController();
    setChecking(true);
    const timer = window.setTimeout(async () => {
      const formatted = /^https?:\/\//i.test(url.trim()) ? url.trim() : 'https://' + url.trim();
      try {
        const result = await api.post('/sites/validate-url', { url: formatted }, { signal: controller.signal });
        if (active && result.data.valid) setVerified(url);
        else if (active) setError(result.data.error || 'A static HTML/CSS/JS website is required.');
      } catch (problem: any) {
        if (active) setError(problem.response?.data?.error || 'Could not verify this website.');
      } finally { if (active) setChecking(false); }
    }, 450);
    return () => { active = false; controller.abort(); window.clearTimeout(timer); };
  }, [url]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid || verified !== url || submitting) return;
    setSubmitting(true); setError('');
    const formatted = /^https?:\/\//i.test(url.trim()) ? url.trim() : 'https://' + url.trim();
    try {
      const site = await createSite({ sourceUrl: formatted, name: '', sourceType: 'URL' });
      setTargetUrl(formatted); setSiteId(site.id); onNext();
    } catch (problem: any) { setError(problem.response?.data?.error || 'Unable to create the project.'); }
    finally { setSubmitting(false); }
  };
  return <form onSubmit={submit}>
    <section className="step-content"><div className="conversion-entry"><div className="conversion-source-form">
      <label className="label" htmlFor="source-url">Static website URL</label>
      <div className="source-address"><Globe size={20} strokeWidth={1.5} /><input className="input" id="source-url" name="url" inputMode="url" autoComplete="url" autoCapitalize="none" spellCheck={false} placeholder="https://example.com" required value={url} disabled={submitting} onChange={event => setUrl(event.target.value)} /></div>
      <div className="source-status">
      {checking && <p className="url-status" role="status"><Loader2 className="animate-spin" size={15} />Verifying website...</p>}
      {!checking && verified === url && valid && <p className="url-status"><CheckCircle2 size={15} />Static website verified</p>}
      {url && !valid && <p className="form-error">Enter a complete website URL.</p>}
      {error && <p className="notice-box error" role="alert">{error}</p>}
      </div></div><ConversionVisual /></div>
    </section><div className="step-actions"><button className="btn btn-primary" disabled={!valid || verified !== url || checking || submitting}>
      {submitting ? 'Creating project...' : 'Continue to settings'}{submitting ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}</button></div>
  </form>;
}
