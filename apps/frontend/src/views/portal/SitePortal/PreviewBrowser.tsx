import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ExternalLink, Globe2, Home, Loader2, Maximize, Minimize, RotateCw } from 'lucide-react';
import './PreviewBrowser.css';

function httpUrl(value: string): URL | null {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url : null; }
  catch { return null; }
}

export function previewRoute(value: string, origin: string, sourceUrl: string): string {
  const source = httpUrl(sourceUrl);
  let url: URL | undefined;
  for (const protocol of new Set([new URL(origin).protocol, source?.protocol].filter(Boolean))) {
    try {
      const candidate = new URL(protocol + '//' + value);
      if (candidate.origin === origin || candidate.origin === source?.origin) { url = candidate; break; }
    } catch { /* Paths are parsed relative to the preview below. */ }
  }
  url ||= new URL(value, origin + '/');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      (url.origin !== origin && url.origin !== source?.origin)) throw new Error('Enter a path or a URL from this website.');
  const path = url.pathname.replace(/^\/__site(?=\/|$)/, '') || '/';
  if (path.startsWith('/__preview/')) throw new Error('This address is reserved for the preview connection.');
  return path + url.search + url.hash;
}

export default function PreviewBrowser({ url, sourceUrl, title }: { url: string; sourceUrl: string; title: string }) {
  const connection = httpUrl(url);
  const origin = connection?.origin || '';
  const initial = connection && !connection.pathname.startsWith('/__preview/')
    ? connection.pathname + connection.search + connection.hash : '/';
  const iframe = useRef<HTMLIFrameElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const editing = useRef(false);
  const history = useRef({ entries: [initial], index: 0 });
  const [navigation, setNavigation] = useState(history.current);
  const [address, setAddress] = useState(origin + initial);
  const [frameUrl, setFrameUrl] = useState(url);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fullscreen, setFullscreen] = useState(false);

  const remember = useCallback((path: string) => {
    const current = history.current;
    if (current.entries[current.index] !== path) {
      history.current = { entries: [...current.entries.slice(0, current.index + 1), path], index: current.index + 1 };
      setNavigation(history.current);
    }
    if (!editing.current) setAddress(origin + path);
  }, [origin]);

  useEffect(() => {
    const update = (event: MessageEvent) => {
      if (!origin || event.origin !== origin || event.source !== iframe.current?.contentWindow ||
          event.data?.type !== 'converter:preview-location' || typeof event.data.path !== 'string') return;
      try { remember(previewRoute(event.data.path, origin, sourceUrl)); }
      catch { /* Reject external and reserved addresses reported by source scripts. */ }
    };
    const resized = () => setFullscreen(document.fullscreenElement === surface.current);
    window.addEventListener('message', update);
    document.addEventListener('fullscreenchange', resized);
    return () => { window.removeEventListener('message', update); document.removeEventListener('fullscreenchange', resized); };
  }, [origin, sourceUrl, remember]);

  const load = (path: string) => {
    editing.current = false;
    setAddress(origin + path); setError(''); setLoading(true);
    setFrameUrl(origin + path); setRevision(value => value + 1);
  };
  const visit = (value: string) => {
    try { const path = previewRoute(value.trim(), origin, sourceUrl); remember(path); load(path); }
    catch (problem) { setError((problem as Error).message); }
  };
  const move = (offset: number) => {
    const current = history.current;
    const index = current.index + offset;
    if (index < 0 || index >= current.entries.length) return;
    history.current = { ...current, index }; setNavigation(history.current); load(current.entries[index]);
  };
  const current = navigation.entries[navigation.index];
  if (!connection) return <p className="notice-box error" role="alert">The preview address is invalid. Start a new preview.</p>;
  return <div className="preview-browser" ref={surface}>
    <div className="preview-browser-bar">
      <div className="preview-browser-navigation">
        <button type="button" className="icon-control" title="Back in preview" aria-label="Back in preview" disabled={navigation.index === 0} onClick={() => move(-1)}><ArrowLeft size={15} /></button>
        <button type="button" className="icon-control" title="Forward in preview" aria-label="Forward in preview" disabled={navigation.index === navigation.entries.length - 1} onClick={() => move(1)}><ArrowRight size={15} /></button>
        <button type="button" className="icon-control" title="Reload preview" aria-label="Reload preview" onClick={() => load(current)}><RotateCw size={15} /></button>
        <button type="button" className="icon-control" title="Preview home" aria-label="Preview home" onClick={() => visit('/')}><Home size={15} /></button>
      </div>
      <form className="preview-address" onSubmit={event => { event.preventDefault(); visit(address); }}>
        {loading ? <Loader2 size={14} className="animate-spin" aria-label="Loading preview page" /> : <Globe2 size={14} />}
        <input aria-label="Preview address" type="text" inputMode="url" autoComplete="off" autoCapitalize="none" spellCheck={false} value={address}
          onFocus={() => { editing.current = true; }} onBlur={() => { editing.current = false; }} onChange={event => setAddress(event.target.value)} />
        <button type="submit" className="icon-control" title="Go to address" aria-label="Go to address"><ArrowRight size={14} /></button>
      </form>
      <div className="preview-browser-tools">
        <a className="icon-control" title="Open preview in a new tab" aria-label="Open preview in a new tab" href={origin + current} target="_blank" rel="noreferrer"><ExternalLink size={15} /></a>
        {document.fullscreenEnabled && <button type="button" className="icon-control" title={fullscreen ? 'Exit fullscreen preview' : 'Fullscreen preview'} aria-label={fullscreen ? 'Exit fullscreen preview' : 'Fullscreen preview'} onClick={async () => {
          try { if (fullscreen) await document.exitFullscreen(); else await surface.current?.requestFullscreen(); }
          catch { setError('Fullscreen is unavailable in this browser.'); }
        }}>{fullscreen ? <Minimize size={15} /> : <Maximize size={15} />}</button>}
      </div>
    </div>
    {error && <p className="preview-address-error" role="alert">{error}</p>}
    <iframe key={revision} ref={iframe} src={frameUrl} title={title} onLoad={() => setLoading(false)} sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
  </div>;
}
