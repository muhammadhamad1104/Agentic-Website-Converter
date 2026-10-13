import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import * as Tabs from '@radix-ui/react-tabs';
import { ArrowLeft, Download, Play, Square, ExternalLink, Trash2, Loader2, Globe2, Monitor } from 'lucide-react';
import api from '../../../services/api';
import { duration, useResource } from '../../../hooks/useResource';
import { usePreview } from '../../../hooks/usePreview';
import { Workspace, Metrics, Status, LoadError } from '../../components/Workspace/Workspace';
import PreviewBrowser from './PreviewBrowser';

type Project = { site: { id: string; name: string; sourceUrl: string; sourceType?: string; status: string; createdAt: string;
  crawls: { id: string }[]; hasArtifacts: boolean; workerAvailable: boolean;
  entities: { name: string; fields: { name: string; type: string }[] }[];
  traceEvents: { node?: string; node_name?: string; status?: string; output_status?: string; duration_ms?: number; timestamp?: string; timestamp_ms?: number }[];
  validation: { issues?: { message: string }[]; build_status?: string } | null };
  stats: { pages: number; assets: number; models: number; durationMs: number | null; editableFields: number | null } };

export default function SitePortal() {
  const { id } = useParams();
  const navigate = useNavigate();
  const resource = useResource<Project>('/sites/' + id, 10000);
  const site = resource.data?.site;
  const stats = resource.data?.stats;
  const jobId = site?.crawls[0]?.id;
  const preview = usePreview(jobId);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [view, setView] = useState('preview');
  const dialog = useRef<HTMLDialogElement>(null);
  const download = async () => {
    if (!jobId) return;
    setDownloading(true); setError('');
    try {
      const result = await api.get('/jobs/' + jobId + '/download', { responseType: 'blob', timeout: 0 });
      const url = URL.createObjectURL(result.data);
      const anchor = document.createElement('a'); anchor.href = url;
      anchor.download = (site?.name || 'converted-site').replace(/[^a-z0-9-]/gi, '-') + '.zip';
      anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError('The export could not be downloaded. Please try again.'); }
    finally { setDownloading(false); }
  };
  const remove = async () => {
    if (confirmation !== site?.name) return;
    setDeleting(true); setError('');
    try { await preview.stop(); await api.delete('/sites/' + id); navigate('/dashboard'); }
    catch { setError('The project could not be deleted.'); }
    finally { setDeleting(false); dialog.current?.close(); }
  };
  return <Workspace>
    <Link to="/dashboard" className="btn btn-ghost btn-sm"><ArrowLeft size={15} />Projects</Link>
    {resource.error && <LoadError error={resource.error} retry={resource.refresh} />}
    {resource.loading && !site && <div className="loading-line" role="status" aria-label="Loading project" />}
    {site && stats && <>
      <header className="workspace-title" style={{ marginTop: 28 }}>
        <div><p className="eyebrow">PROJECT / {new Date(site.createdAt).toLocaleDateString()}</p><h1>{site.name}</h1>
          {site.sourceType === 'ZIP' ? <span className="source-link">{site.sourceUrl}</span> : <a href={site.sourceUrl} target="_blank" rel="noreferrer" className="source-link">{site.sourceUrl} <ExternalLink size={12} /></a>}</div>
        <div className="workspace-actions"><Status value={site.status} />
          <button className="btn btn-primary" disabled={!jobId || downloading} onClick={download}>
            {downloading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}{downloading ? 'Packaging...' : 'Download'}</button>
          <button className="icon-control" title="Delete project" aria-label="Delete project" onClick={() => { setConfirmation(''); dialog.current?.showModal(); }}><Trash2 size={15} /></button>
        </div>
      </header>
      {error && <div className="notice-box error" role="alert">{error}</div>}
      {!site.workerAvailable && <div className="notice-box">Worker data is temporarily unavailable. Stored project data is shown.</div>}
      <Metrics items={[{ label: 'Captured pages', value: stats.pages }, { label: 'Captured assets', value: stats.assets },
        { label: 'Content models', value: stats.models }, { label: 'Processing time', value: duration(stats.durationMs) }]} />
      {Boolean(site.validation?.issues?.length) && <details className="notice-box"><summary>{site.validation!.issues!.length} validation notices</summary>
        <ul>{site.validation!.issues!.map((issue, index) => <li key={index}>{issue.message}</li>)}</ul></details>}
      <Tabs.Root className="workspace-tabs project-tabs" value={view} onValueChange={setView}>
        <Tabs.List className="workspace-tab-list" aria-label="Project views"><Tabs.Trigger value="preview">Preview</Tabs.Trigger><Tabs.Trigger value="schema">Content schema</Tabs.Trigger><Tabs.Trigger value="activity">Activity</Tabs.Trigger></Tabs.List>
        <Tabs.Content value="preview" className="workspace-tab-panel" forceMount hidden={view !== 'preview'}>
      <section className="preview-surface" aria-label="Website preview">
        {preview.status !== 'stopped' && <div className="preview-toolbar"><span className="preview-heading"><Monitor size={15} />{preview.status === 'starting' ? 'Preparing preview...' : preview.status === 'ready' ? 'Live preview' : 'Preview unavailable'}</span>
          <div className="workspace-actions">
            <button className="btn btn-secondary btn-sm" onClick={preview.stop}><Square size={13} />Stop</button></div></div>}
        {preview.status === 'ready' && preview.url ? <PreviewBrowser key={preview.url} url={preview.url} sourceUrl={site.sourceUrl} title={site.name + ' preview'} /> :
          <div className="empty-view" role="status">{preview.status === 'starting' ? <div className="preview-startup">
            <div className="preview-startup-heading"><Loader2 className="animate-spin" size={22} /><div><strong>{preview.message || 'Starting the generated application'}</strong>
              <span>{preview.elapsedSeconds ? preview.elapsedSeconds + 's elapsed' : 'Starting now'}</span></div><b>{Math.round(preview.progress || 0)}%</b></div>
            <div className="preview-progress" aria-label="Preview startup progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(preview.progress || 0)} role="progressbar">
              <span style={{ width: Math.max(4, Math.min(100, preview.progress || 0)) + '%' }} /></div>
            <p>The first launch may take a few minutes. This page will update as each build stage completes.</p>
          </div> : preview.status === 'stopped' ? <><Globe2 size={29} strokeWidth={1.2} /><p>{site.hasArtifacts ? 'Ready to preview.' : 'Your application is not ready yet.'}</p><button className="btn btn-secondary" disabled={!site.hasArtifacts} onClick={preview.start}><Play size={14} />Start preview</button></> : <><p>{preview.error || 'The preview could not be started.'}</p><button className="btn btn-secondary" disabled={!site.hasArtifacts} onClick={preview.start}><Play size={14} />Retry preview</button></>}</div>}
      </section>
        </Tabs.Content>
        <Tabs.Content value="schema" className="workspace-tab-panel"><p className="muted project-view-count">{stats.editableFields == null ? 'Fields not measured' : stats.editableFields + ' editable fields'}</p>
          {site.entities.length ? site.entities.map((entity, index) => <details className="schema-entry" key={entity.name + index}><summary>{entity.name}</summary>
            <ul>{(entity.fields || []).map((field, index) => <li key={field.name + index}><span>{field.name}</span><code>{field.type}</code></li>)}</ul></details>) : <p className="muted">No schema has been recorded.</p>}
        </Tabs.Content>
        <Tabs.Content value="activity" className="workspace-tab-panel"><p className="muted project-view-count">{site.traceEvents.length} events</p>
          <div className="activity-list">{site.traceEvents.length ? site.traceEvents.map((event, index) => <div className="event-row" key={index}>
            <div>{event.node || event.node_name || 'Worker event'}<small>{event.output_status || event.status || 'Recorded'}{event.timestamp_ms != null || event.timestamp ? ' / ' + new Date(event.timestamp_ms ?? event.timestamp!).toLocaleString() : ''}</small></div>
            <span>{duration(event.duration_ms)}</span></div>) : <p className="muted">No worker events are available.</p>}</div>
        </Tabs.Content>
      </Tabs.Root>
      <dialog ref={dialog} className="dialog" aria-labelledby="delete-project-title"><h2 id="delete-project-title">Delete project?</h2><p>This cannot be undone. Enter "{site.name}" to confirm.</p>
        <input className="input" aria-label="Project name confirmation" value={confirmation} onChange={event => setConfirmation(event.target.value)} />
        <div className="workspace-actions"><button className="btn btn-secondary" onClick={() => dialog.current?.close()}>Cancel</button>
          <button className="btn btn-danger" disabled={deleting || confirmation !== site.name} onClick={remove}><Trash2 size={14} />{deleting ? 'Deleting...' : 'Delete'}</button></div></dialog>
    </>}
  </Workspace>;
}
