import { useEffect, useState } from 'react';
import { Check, CheckCircle, ChevronDown, Code2, Copy, Database, Loader2, RefreshCw, Table, XCircle } from 'lucide-react';
import { useJobStore } from '../../../../store/jobStore';
import toast from 'react-hot-toast';

function fieldsOf(entity: any): any[] {
  if (Array.isArray(entity.fields)) return entity.fields;
  if (Array.isArray(entity.properties)) return entity.properties;
  if (entity.properties && typeof entity.properties === 'object') return Object.entries(entity.properties).map(([name, definition]) => ({
    ...(definition && typeof definition === 'object' ? definition : { type: definition }), name,
    required: Array.isArray(entity.required) ? entity.required.includes(name) : undefined,
  }));
  return [];
}

export default function Step5Approve({ onNext, onBack, jobId }: {
  onNext: () => void; onBack: () => void; jobId?: string | null;
}) {
  const { submitSchemaDecision, getJob } = useJobStore();
  const [schema, setSchema] = useState<Record<string, any> | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'approved' | 'rejected' | null>(null);
  const [feedback, setFeedback] = useState('');
  const [view, setView] = useState<'table' | 'json'>('table');
  const [revision, setRevision] = useState(0);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let active = true;
    setSchema(null); setError('');
    if (!jobId) { setError('No active conversion found.'); return; }
    getJob(jobId).then((job: any) => {
      if (active) {
        const proposal = job?.workerJob?.schema_proposal;
        if (proposal) setSchema(proposal);
        else setError('The worker has not returned a schema for review.');
      }
    }).catch(() => { if (active) setError('Unable to load the schema.'); });
    return () => { active = false; };
  }, [jobId, getJob, revision]);
  const entities: any[] = schema?.entities || schema?.models || [];
  const fieldCount = entities.reduce((total, entity) => total + fieldsOf(entity).length, 0);
  const decide = async (decision: 'approved' | 'rejected') => {
    if (!jobId || !schema || busy) return;
    setBusy(decision);
    try {
      await submitSchemaDecision(jobId, decision, decision === 'rejected'
        ? { previous_schema: schema, feedback_text: feedback } : undefined);
      if (decision === 'approved') onNext(); else onBack();
    } catch (problem: any) {
      toast.error(problem.response?.data?.error || 'Unable to submit your decision. Please try again.');
    } finally { setBusy(null); }
  };
  return <>
    <section className="step-content">
      {error && <div className="notice-box error" role="alert">{error}<button type="button" className="btn btn-ghost btn-sm" onClick={() => setRevision(value => value + 1)}><RefreshCw size={13} />Reload schema</button></div>}
      {!schema && !error && <p className="step-loading" role="status"><Loader2 size={16} className="animate-spin" />Loading schema...</p>}
      {schema && <>
        <div className="schema-review-toolbar"><div><h3>{entities.length} content models</h3><p>{fieldCount} fields</p></div><div className="schema-view-controls">
          <div className="schema-view-toggle" role="group" aria-label="Schema display">
            <button type="button" title="Table view" aria-label="Table view" aria-pressed={view === 'table'} onClick={() => setView('table')}><Table size={16} /></button>
            <button type="button" title="Schema JSON" aria-label="Schema JSON" aria-pressed={view === 'json'} onClick={() => setView('json')}><Code2 size={16} /></button>
          </div><button type="button" className="icon-control" title={copied ? 'Schema copied' : 'Copy schema JSON'} aria-label={copied ? 'Schema copied' : 'Copy schema JSON'} onClick={async () => {
            try { await navigator.clipboard.writeText(JSON.stringify(schema, null, 2)); setCopied(true); }
            catch { toast.error('Schema could not be copied. Check clipboard permissions.'); }
          }}>{copied ? <Check size={14} /> : <Copy size={14} />}</button>
        </div></div>
        {view === 'json' ? <pre className="schema-code" tabIndex={0} aria-label="Schema JSON content">{JSON.stringify(schema, null, 2)}</pre> : <div className="schema-review-list">
          {entities.length === 0 && <p className="muted">No content models were proposed.</p>}
          {entities.map((entity, index) => {
            const fields = fieldsOf(entity);
            return <details className="schema-review-model" key={entity.name || index} open={index === 0}>
              <summary><span className="schema-model-name"><Database size={17} strokeWidth={1.5} />{entity.name || 'Unnamed model'}</span>
                <span className="schema-model-count">{fields.length} fields<ChevronDown size={14} /></span></summary>
              <div className="table-scroll"><table className="data-table"><thead><tr><th>Field</th><th>Type</th><th>Required</th></tr></thead><tbody>
                {fields.map((field: any, fieldIndex: number) => {
                  const type = typeof field === 'string' ? '--' : field.type || field.data_type || '--';
                  return <tr key={field.name || fieldIndex}>
                    <td>{typeof field === 'string' ? field : field.name || 'Unnamed field'}</td>
                    <td><code>{typeof type === 'string' ? type : JSON.stringify(type)}</code></td>
                    <td>{typeof field === 'string' || field.required == null ? '--' : field.required ? <span className="schema-required"><Check size={12} />Yes</span> : 'No'}</td>
                  </tr>;
                })}
              </tbody></table></div>
            </details>;
          })}
        </div>}
        <div className="schema-revision"><label htmlFor="schema-feedback">Revision notes</label>
          <textarea id="schema-feedback" className="input" rows={3} value={feedback} onChange={event => setFeedback(event.target.value)} disabled={!!busy} />
        </div>
      </>}
    </section>
    <div className="step-actions"><button type="button" className="btn btn-secondary" onClick={() => decide('rejected')} disabled={!schema || !!busy}>
      {busy === 'rejected' ? <Loader2 size={16} className="animate-spin" /> : <XCircle size={16} />}Request revision</button>
      <button type="button" className="btn btn-primary" onClick={() => decide('approved')} disabled={!schema || !!busy}>
        {busy === 'approved' ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}Approve and generate</button></div>
  </>;
}
