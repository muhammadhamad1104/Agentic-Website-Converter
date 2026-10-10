import { Link } from 'react-router-dom';
import { useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, Globe2, Plus, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { Workspace, Metrics, Status, LoadError } from '../../components/Workspace/Workspace';
import { useResource, duration, AccountSummary } from '../../../hooks/useResource';

export default function Dashboard() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const projects = useResource<{ sites: any[]; total: number }>('/sites?page=' + page + '&limit=20', 15000);
  const account = useResource<AccountSummary>('/account/summary', 15000);
  const stats = account.data?.stats;
  const plan = account.data?.plan;
  const sites = (projects.data?.sites || []).filter(site => {
    const matchesSearch = (site.name + site.sourceUrl).toLowerCase().includes(search.toLowerCase());
    const ready = ['ready', 'validated', 'completed', 'deployed'].includes(site.status.toLowerCase());
    const failed = ['failed', 'error', 'cancelled'].includes(site.status.toLowerCase());
    return matchesSearch && (status === 'all' || (status === 'ready' ? ready : status === 'failed' ? failed : !ready && !failed));
  });
  const exhausted = Boolean(plan && !plan.canConvert);
  const actionPath = exhausted ? '/checkout' : '/wizard';
  const actionLabel = exhausted ? 'Upgrade to Pro' : 'New conversion';
  const filtered = Boolean(search || status !== 'all');
  return <Workspace>
    <div className="workspace-title"><div><h1>Your <em>projects.</em></h1></div>
      <div className="workspace-actions"><button className="icon-control" title="Refresh projects" aria-label="Refresh projects" onClick={() => { projects.refresh(); account.refresh(); }}><RefreshCw size={16} /></button>
        <Link className="btn btn-primary" to={actionPath}><Plus size={16} />{actionLabel}</Link></div></div>
    {account.error && <LoadError error={account.error} retry={account.refresh} />}
    <Metrics items={[{ label: 'Projects', value: stats?.totalSites ?? '--' }, { label: 'Conversions', value: stats?.totalConversions ?? '--' },
      { label: 'Active jobs', value: stats?.activeJobs ?? '--' }, { label: 'Average processing time', value: stats ? duration(stats.averageDurationMs) : '--', note: stats ? stats.timedConversions + ' measured jobs' : undefined }]} />
    {plan && <div className="quota-band"><div className="quota-detail"><ShieldCheck size={20} strokeWidth={1.4} /><div><strong>{plan.name} membership</strong><p>{plan.conversionLimit === null ? 'Unlimited conversions' : `${plan.used} of ${plan.conversionLimit} lifetime conversions used`}</p></div></div>
      <div className="workspace-actions">{plan.conversionLimit !== null && <><progress className="usage-meter" aria-label="Conversion usage" value={Math.min(plan.used, plan.conversionLimit)} max={plan.conversionLimit} /><Link to="/checkout" className="btn btn-ghost btn-sm">Explore Pro <ArrowRight size={14} /></Link></>}</div></div>}
    <div className="section-bar"><h2>All projects <span className="muted">/ {projects.data?.total ?? '--'}</span></h2><div className="table-tools"><label className="search-field"><Search size={15} /><input aria-label="Search projects" placeholder="Search this page" value={search} onChange={event => setSearch(event.target.value)} /></label><select aria-label="Filter project status on this page" value={status} onChange={event => setStatus(event.target.value)}><option value="all">All statuses</option><option value="ready">Ready</option><option value="active">In progress</option><option value="failed">Failed</option></select></div></div>
    {projects.error && <LoadError error={projects.error} retry={projects.refresh} />}
    {projects.loading && !projects.data ? <div className="loading-line" role="status" aria-label="Loading projects" /> : projects.error && !projects.data ? null :
      !sites.length ? <div className="empty-view"><Globe2 size={32} strokeWidth={1.2} /><h2>{filtered ? 'No matching projects' : 'Your next project starts here.'}</h2>{filtered ? <button className="btn btn-secondary" onClick={() => { setSearch(''); setStatus('all'); }}>Clear filters</button> : <Link to={actionPath} className="btn btn-secondary">{actionLabel} <ArrowRight size={16} /></Link>}</div> :
      <div className="data-scroll"><table className="data-table"><thead><tr><th>Project</th><th>Status</th><th className="secondary-column">Pages / assets</th><th className="secondary-column">Processing time</th><th><span className="sr-only">Open</span></th></tr></thead><tbody>{sites.map(site => <tr key={site.id}>
        <td><Link to={'/sites/' + site.id} className="project-title"><span className="project-symbol"><Globe2 size={19} /></span><span><strong>{site.name}</strong><small>{site.sourceUrl}</small></span></Link></td>
        <td><Status value={site.status} /></td><td className="secondary-column">{site.pages} / {site.assets}</td><td className="secondary-column">{duration(site.durationMs)}</td>
        <td><Link to={'/sites/' + site.id} className="icon-control" aria-label={'Open ' + site.name}><ArrowRight size={16} /></Link></td></tr>)}</tbody></table></div>}
    {(projects.data?.total || 0) > 20 && <div className="pager"><button className="icon-control" aria-label="Previous page" disabled={page === 1} onClick={() => setPage(page - 1)}><ChevronLeft size={17} /></button><span>Page {page} of {Math.ceil((projects.data?.total || 0) / 20)}</span><button className="icon-control" aria-label="Next page" disabled={page * 20 >= (projects.data?.total || 0)} onClick={() => setPage(page + 1)}><ChevronRight size={17} /></button></div>}
  </Workspace>;
}
