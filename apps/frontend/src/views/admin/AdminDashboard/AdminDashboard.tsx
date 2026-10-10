import { Link } from 'react-router-dom';
import * as Tabs from '@radix-ui/react-tabs';
import { RefreshCw, ArrowUpRight, ShieldCheck, FolderOpen, CircleAlert } from 'lucide-react';
import { useResource, duration } from '../../../hooks/useResource';
import { Workspace, Metrics, Status, LoadError } from '../../components/Workspace/Workspace';

type Summary = { stats: { users: number; sites: number; jobs: number; failedJobs: number; activeJobs: number; averageDurationMs: number | null; timedConversions: number }; recentUsers: any[]; recentJobs: any[]; plans: { plan: string; _count: number }[] };
export default function AdminDashboard() {
  const { data, error, loading, refresh } = useResource<Summary>('/admin/summary', 15000);
  const accountCount = data?.plans.reduce((total, plan) => total + plan._count, 0) || 0;
  return <Workspace><div className="workspace-title"><div><h1>System <em>overview.</em></h1></div><div className="workspace-actions"><Link className="btn btn-secondary" to="/profile#security"><ShieldCheck size={15} />Account security</Link><button className="icon-control" title="Refresh system data" aria-label="Refresh system data" onClick={refresh}><RefreshCw size={15} /></button></div></div>
    {error && <LoadError error={error} retry={refresh} />}{loading && !data && <div className="loading-line" aria-label="Loading system data" role="status" />}
    <Metrics items={[{ label: 'Accounts', value: data?.stats.users ?? '--' }, { label: 'Conversion jobs', value: data?.stats.jobs ?? '--' }, { label: 'Active jobs', value: data?.stats.activeJobs ?? '--' }, { label: 'Average processing time', value: data ? duration(data.stats.averageDurationMs) : '--', note: data ? data.stats.timedConversions + ' measured jobs' : undefined }]} />
    <Tabs.Root className="workspace-tabs admin-tabs" defaultValue="accounts">
    <Tabs.List className="workspace-tab-list" aria-label="Administration views"><Tabs.Trigger value="accounts">Accounts</Tabs.Trigger><Tabs.Trigger value="conversions">Conversions</Tabs.Trigger><Tabs.Trigger value="health">Health</Tabs.Trigger></Tabs.List>
    <Tabs.Content value="accounts" className="workspace-tab-panel">
    <div className="section-bar"><h2>Recent accounts</h2><span className="muted">{data?.stats.users ?? '--'} total</span></div>
      <div className="data-scroll" tabIndex={0} role="region" aria-label="Recent accounts"><table className="data-table"><thead><tr><th>Account</th><th>Plan / role</th><th>Status</th></tr></thead><tbody>{data?.recentUsers.map(user => <tr key={user.id}><td><strong>{user.name}</strong><small>{user.email}</small></td><td>{user.role === 'ADMIN' ? 'Admin' : user.plan.toLowerCase()}</td><td><Status value={user.status} /></td></tr>)}</tbody></table></div>
      {data && !data.recentUsers.length && <p className="empty-view">No accounts recorded.</p>}
    </Tabs.Content><Tabs.Content value="health" className="workspace-tab-panel">
      <div className="section-bar"><h2>Workspace health</h2><ShieldCheck size={17} strokeWidth={1.4} /></div>
      <div className="health-strip"><div><FolderOpen size={21} strokeWidth={1.3} /><span><strong>{data?.stats.sites ?? '--'}</strong><small>Projects</small></span></div><div><CircleAlert size={21} strokeWidth={1.3} /><span><strong>{data?.stats.failedJobs ?? '--'}</strong><small>Failed jobs</small></span></div></div>
      <div className="section-bar"><h2>Membership mix</h2><span className="muted">{data ? accountCount : '--'} accounts</span></div><div className="plan-mix">{data?.plans.map(plan => <div key={plan.plan}><div className="plan-mix-label"><span>{plan.plan.charAt(0) + plan.plan.slice(1).toLowerCase()}</span><span>{plan._count}</span></div><progress aria-label={plan.plan + ' account share'} value={plan._count} max={Math.max(accountCount, 1)} /></div>)}</div>
    </Tabs.Content><Tabs.Content value="conversions" className="workspace-tab-panel">
    <div className="data-scroll" tabIndex={0} role="region" aria-label="Recent conversions"><table className="data-table"><thead><tr><th>Project</th><th>Status</th><th className="secondary-column">Processing time</th><th className="secondary-column">Created</th><th><span className="sr-only">Open</span></th></tr></thead><tbody>{data?.recentJobs.map(job => <tr key={job.id}><td><strong>{job.site.name}</strong><small>{job.site.owner.email}</small></td><td><Status value={job.status} /></td><td className="secondary-column">{duration(job.durationMs)}</td><td className="secondary-column">{new Date(job.createdAt).toLocaleDateString()}</td><td><Link className="icon-control" aria-label={'Open ' + job.site.name} to={'/sites/' + job.site.id}><ArrowUpRight size={15} /></Link></td></tr>)}</tbody></table></div>
    {data && !data.recentJobs.length && <p className="empty-view">No conversion jobs recorded.</p>}
    </Tabs.Content></Tabs.Root>
  </Workspace>;
}
