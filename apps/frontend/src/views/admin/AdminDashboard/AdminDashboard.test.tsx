import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminDashboard from './AdminDashboard';
import { useResource } from '../../../hooks/useResource';
vi.mock('../../../hooks/useResource', async importOriginal => ({ ...await importOriginal<object>(), useResource: vi.fn() }));
vi.mock('../../components/Workspace/Workspace', async importOriginal => ({ ...await importOriginal<object>(), Workspace: ({ children }: any) => <main>{children}</main> }));
let resource: any;
const show = () => render(<MemoryRouter><AdminDashboard /></MemoryRouter>);
describe('Administration overview', () => {
  beforeEach(() => {
    resource = { data: { stats: { users: 10, sites: 23, jobs: 30, activeJobs: 3, failedJobs: 7, averageDurationMs: 120000, timedConversions: 20 }, recentUsers: [], recentJobs: [], plans: [{ plan: 'STARTER', _count: 8 }, { plan: 'PRO', _count: 2 }] }, loading: false, error: '', refresh: vi.fn() };
    vi.mocked(useResource).mockReturnValue(resource);
  });
  it('shows actual membership counts and measured duration', () => {
    show(); fireEvent.mouseDown(screen.getByRole('tab', { name: 'Health' }), { button: 0, ctrlKey: false });
    expect(screen.getByRole('progressbar', { name: 'STARTER account share' })).toHaveAttribute('value', '8');
    expect(screen.getByRole('progressbar', { name: 'PRO account share' })).toHaveAttribute('max', '10');
    expect(screen.getByText('2m 0s')).toBeInTheDocument(); expect(screen.getByText('20 measured jobs')).toBeInTheDocument();
    expect(useResource).toHaveBeenCalledWith('/admin/summary', 15000);
  });
  it('refreshes live system data on request', () => {
    show(); fireEvent.click(screen.getByRole('button', { name: 'Refresh system data' })); expect(resource.refresh).toHaveBeenCalledTimes(1);
  });
  it('does not present a zero account total while data is loading', () => {
    resource.data = null; resource.loading = true; show(); expect(screen.getByRole('status', { name: 'Loading system data' })).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Health' }), { button: 0, ctrlKey: false });
    expect(screen.getByText('-- accounts')).toBeInTheDocument(); expect(screen.queryByText('0 accounts')).not.toBeInTheDocument();
  });
  it('shows conversion history in its own tab without duplicating the account view', () => {
    resource.data.recentJobs = [{ id: 'job', site: { id: 'site', name: 'Advisory', owner: { email: 'member@example.com' } }, status: 'COMPLETED', durationMs: 60000, createdAt: '2026-10-01' }];
    show(); expect(screen.queryByText('Advisory')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Workspace health' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Recent accounts' })).toHaveAttribute('tabindex', '0');
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Conversions' }), { button: 0, ctrlKey: false });
    expect(screen.getByRole('link', { name: 'Open Advisory' })).toHaveAttribute('href', '/sites/site');
    expect(screen.queryByRole('heading', { name: 'Recent accounts' })).not.toBeInTheDocument();
  });
});
