import { useEffect, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Download, ArrowRight, Loader2, FolderDown } from 'lucide-react';
import { useJobStore } from '../../../../store/jobStore';
import { Metrics } from '../../../components/Workspace/Workspace';
import api from '../../../../services/api';

export default function Step7Export({ jobId }: { jobId?: string | null }) {
  const { getJob } = useJobStore();
  const [job, setJob] = useState<any>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    if (jobId) getJob(jobId).then(value => { if (active) setJob(value); }).catch(() => { if (active) setError('Unable to fetch the export report.'); });
    return () => { active = false; };
  }, [jobId, getJob]);
  const worker = job?.workerJob || {};
  const report = worker.validation_report || {};
  const source = worker.generated_artifacts?.source_report || {};
  const warnings = [...new Set<string>([...(report.issues || []).map((issue: any) => String(issue.message)),
    ...(worker.errors || []), ...(report.deployment_ready ? [] : ['Deployment readiness not confirmed.'])])];
  const download = async () => {
    if (!jobId) return;
    setBusy(true); setError('');
    try {
      const result = await api.get('/jobs/' + jobId + '/download', { responseType: 'blob', timeout: 0 });
      const url = URL.createObjectURL(result.data); const link = document.createElement('a');
      link.href = url; link.download = 'converted-site-' + jobId + '.zip'; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError('Failed to download the source package. Please try again.'); }
    finally { setBusy(false); }
  };
  return <>
    <section className="step-content"><div style={{ '--metrics': 3 } as CSSProperties}><Metrics items={[{ label: 'Collections', value: (worker.schema_proposal?.entities || worker.schema_proposal?.models)?.length ?? '--' },
      { label: 'Captured pages', value: source.page_count ?? '--' }, { label: 'Captured assets', value: source.asset_count ?? '--' }]} /></div>
      {error && <p className="notice-box error" role="alert">{error}</p>}
      {!job && !error && jobId && <p className="step-loading" role="status"><Loader2 size={15} className="animate-spin" />Loading export report...</p>}
      <div className="conversion-export"><div className="export-delivery"><div className="export-package"><FolderDown size={58} strokeWidth={1} /></div>
      <div className="workspace-actions"><button className="btn btn-primary" disabled={busy || !jobId} onClick={download}>{busy ? <Loader2 size={17} className="animate-spin" /> : <Download size={17} />}{busy ? 'Preparing ZIP...' : 'Download Source Code (.zip)'}</button>
        {job?.siteId && <Link to={'/sites/' + job.siteId} className="btn btn-secondary">Open project <ArrowRight size={16} /></Link>}</div>
      </div><div className="export-manifest"><h3>Delivery manifest</h3><dl className="detail-list"><div><dt>Package</dt><dd>Source ZIP</dd></div><div><dt>Runtime build</dt><dd>{job ? report.build_status || 'Not reported' : '--'}</dd></div><div><dt>Deployment verified</dt><dd>{job ? report.deployment_ready ? 'Yes' : 'Not confirmed' : '--'}</dd></div><div><dt>Conversion ID</dt><dd className="export-id"><code>{jobId || '--'}</code></dd></div>
      </dl></div></div>
      {job && warnings.length > 0 && <details className="notice-box export-notices"><summary>Validation warnings ({warnings.length})</summary><ul>{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
    </section></>;
}
