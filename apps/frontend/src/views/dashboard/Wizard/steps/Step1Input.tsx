import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Globe, Loader2, CheckCircle2, FileArchive, Upload, X } from 'lucide-react';
import { useSiteStore } from '../../../../store/siteStore';
import api from '../../../../services/api';
import ConversionVisual from './ConversionVisual';
const formattedUrl = (value: string) => /^https?:\/\//i.test(value.trim()) ? value.trim() : 'https://' + value.trim();
const isValidTargetUrl = (value: string): boolean => {
  try {
    const url = new URL(formattedUrl(value));
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || /^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(url.hostname));
  } catch { return false; }
};


export default function Step1Input({ onNext, setTargetUrl, setSiteId, setSourceType, initialUrl = '', initialSiteId, initialSourceType = 'URL' }: {
  onNext: () => void; setJobId: (id: string) => void; setTargetUrl: (url: string) => void; setSiteId: (id: string) => void;
  setSourceType?: (type: 'URL' | 'ZIP') => void;
  initialUrl?: string; initialSiteId?: string | null; initialSourceType?: 'URL' | 'ZIP';
}) {
  const [mode, setMode] = useState<'URL' | 'ZIP'>(initialSourceType);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState(initialSourceType === 'URL' ? initialUrl : '');
  const [verified, setVerified] = useState('');
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const submitLock = useRef(false);
  const [verificationAttempt, setVerificationAttempt] = useState(0);
  const { createSite, uploadZip } = useSiteStore();
  const valid = isValidTargetUrl(url);
  useEffect(() => {
    setVerified(''); setError('');
    if (mode !== 'URL' || !isValidTargetUrl(url)) { setChecking(false); return; }
    let active = true;
    const controller = new AbortController();
    setChecking(true);
    const timer = window.setTimeout(async () => {
      const formatted = formattedUrl(url);
      try {
        const result = await api.post('/sites/validate-url', { url: formatted }, { signal: controller.signal });
        if (active && result.data.valid) setVerified(url);
        else if (active) setError(result.data.error || 'A static HTML/CSS/JS website is required.');
      } catch (problem: any) {
        if (active) setError(problem.response?.data?.error || 'Could not verify this website.');
      } finally { if (active) setChecking(false); }
    }, 450);
    return () => { active = false; controller.abort(); window.clearTimeout(timer); };
  }, [url, mode, verificationAttempt]);
  const reuseArchive = mode === 'ZIP' && initialSourceType === 'ZIP' && !!initialSiteId && !file;
  const chooseFile = (selected?: File) => {
    setError(''); setFile(null);
    if (!selected) return;
    if (!selected.name.toLowerCase().endsWith('.zip')) { setError('Choose a .zip website archive.'); return; }
    if (selected.size > 100 * 1024 * 1024) { setError('ZIP exceeds the 100 MB upload limit.'); return; }
    setFile(selected);
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitLock.current || (mode === 'ZIP' ? !file && !reuseArchive : !valid || verified !== url || checking)) return;
    if (reuseArchive) { setTargetUrl(initialUrl); setSiteId(initialSiteId!); setSourceType?.('ZIP'); onNext(); return; }
    submitLock.current = true;
    setSubmitting(true); setError('');
    if (mode === 'ZIP') {
      setProgress(0);
      try {
        const site = await uploadZip(file!, setProgress);
        setTargetUrl(site.sourceUrl); setSiteId(site.id); setSourceType?.('ZIP'); onNext();
      } catch (problem: any) { setError(problem.response?.data?.error || 'Unable to upload the website.'); }
      finally { submitLock.current = false; setSubmitting(false); }
      return;
    }
    const formatted = formattedUrl(url);
    try {
      const site = initialSourceType === 'URL' && formatted === initialUrl && initialSiteId ? { id: initialSiteId } :
        await createSite({ sourceUrl: formatted, name: '', sourceType: 'URL' });
      setTargetUrl(formatted); setSiteId(site.id); setSourceType?.('URL'); onNext();
    } catch (problem: any) { setError(problem.response?.data?.error || 'Unable to create the project.'); }
    finally { submitLock.current = false; setSubmitting(false); }
  };
  return <form onSubmit={submit}>
    <section className="step-content"><div className="conversion-entry"><div className="conversion-source-form">
      <fieldset className="source-mode"><legend className="sr-only">Website source</legend>{(['URL', 'ZIP'] as const).map(type => <label key={type} className={mode === type ? 'selected' : ''}>
        <input type="radio" name="source-mode" checked={mode === type} aria-label={type === 'URL' ? 'Website URL' : 'ZIP archive'} disabled={submitting} onChange={() => { setMode(type); setError(''); }} />
        {type === 'URL' ? <Globe size={15} /> : <FileArchive size={15} />}{type === 'URL' ? 'Website URL' : 'ZIP archive'}</label>)}</fieldset>
      {mode === 'URL' ? <>
      <label className="label" htmlFor="source-url">Static website URL</label>
      <div className="source-address"><Globe size={20} strokeWidth={1.5} /><input className="input" id="source-url" name="url" inputMode="url" autoComplete="url" autoCapitalize="none" spellCheck={false} placeholder="https://example.com" required value={url} disabled={submitting} onChange={event => setUrl(event.target.value)} /></div>
      <div className="source-status">
      {checking && <p className="url-status" role="status"><Loader2 className="animate-spin" size={15} />Verifying website...</p>}
      {!checking && verified === url && valid && <p className="url-status"><CheckCircle2 size={15} />Static website verified</p>}
      {url && !valid && <p className="form-error">Enter a complete website URL.</p>}
      </div></> : <div className={'zip-source ' + (dragging ? 'dragging' : '')} onDragOver={event => { event.preventDefault(); if (!submitting) setDragging(true); }} onDragLeave={() => setDragging(false)}
        onDrop={event => { event.preventDefault(); setDragging(false); if (!submitting) chooseFile(event.dataTransfer.files[0]); }}>
        <input ref={fileInput} className="sr-only" id="website-zip" type="file" accept=".zip,application/zip,application/x-zip-compressed" aria-label="Static website ZIP" disabled={submitting} onChange={event => chooseFile(event.target.files?.[0])} />
        {file ? <div className="zip-selection"><FileArchive size={28} strokeWidth={1.3} /><div><strong>{file.name}</strong><span>{(file.size / 1024 / 1024).toFixed(2)} MB</span></div><button className="icon-control" type="button" title="Remove ZIP" aria-label="Remove ZIP" disabled={submitting} onClick={() => { setFile(null); if (fileInput.current) fileInput.current.value = ''; }}><X size={16} /></button></div> : <><Upload size={26} strokeWidth={1.4} /><span>Drop your static website ZIP</span></>}
        <button type="button" className="btn btn-secondary btn-sm" disabled={submitting} onClick={() => fileInput.current?.click()}><FileArchive size={15} />{file ? 'Change file' : 'Choose ZIP'}</button>
        {!submitting && <small>HTML, CSS, JavaScript & media / up to 100 MB</small>}
        {submitting && <div className="zip-upload-progress" role="status"><span>{progress < 100 ? 'Uploading ' + progress + '%' : 'Verifying static website...'}</span><progress max={100} value={progress} aria-label="ZIP upload progress" /></div>}
      </div>}
      {reuseArchive && <p>{initialUrl}</p>}
      {error && <p className="notice-box error" role="alert">{error}{mode === 'URL' && valid && verified !== url && <button type="button" className="btn btn-ghost btn-sm" disabled={checking} onClick={() => setVerificationAttempt(value => value + 1)}>Retry verification</button>}</p>}
      </div><ConversionVisual /></div>
    </section><div className="step-actions"><button className="btn btn-primary" disabled={submitting || (mode === 'ZIP' ? !file && !reuseArchive : !valid || verified !== url || checking)}>
      {submitting ? mode === 'ZIP' ? 'Uploading website...' : 'Creating project...' : 'Continue to settings'}{submitting ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}</button></div>
  </form>;
}
