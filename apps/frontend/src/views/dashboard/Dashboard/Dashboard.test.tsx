import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Dashboard from './Dashboard';
import { useResource } from '../../../hooks/useResource';

vi.mock('../../../hooks/useResource', async importOriginal => ({ ...await importOriginal<object>(), useResource: vi.fn() }));
vi.mock('../../components/Workspace/Workspace', async importOriginal => ({ ...await importOriginal<object>(), Workspace: ({ children }: any) => <main>{children}</main> }));
let account: any;
let projects: any;
const show = () => render(<MemoryRouter><Dashboard /></MemoryRouter>);
describe('Project workspace', () => {
  beforeEach(() => {
    account = { data: { plan: { key: 'STARTER', name: 'Starter', used: 2, conversionLimit: 5, canConvert: true }, stats: { totalSites: 2, totalConversions: 2, activeJobs: 1, averageDurationMs: 90000, timedConversions: 2 } }, refresh: vi.fn() };
    projects = { data: { sites: [
      { id: 'one', name: 'Advisory', sourceUrl: 'https://example.com', status: 'READY', pages: 12, assets: 30, durationMs: 60000 },
      { id: 'two', name: 'Studio', sourceUrl: 'https://studio.example.com', status: 'FAILED', pages: 3, assets: 8, durationMs: null },
    ], total: 2 }, loading: false, error: '', refresh: vi.fn() };
    vi.mocked(useResource).mockImplementation(path => path === '/account/summary' ? account : projects);
  });
  it('uses measured processing time and actual membership usage', () => {
    show(); expect(screen.getByText('1m 30s')).toBeInTheDocument(); expect(screen.getByText('2 of 5 lifetime conversions used')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Conversion usage' })).toHaveAttribute('value', '2');
  });
  it.each(['PRO', 'ADMIN'])('does not offer an upgrade to unlimited %s accounts', key => {
    account.data.plan = { key, name: key === 'ADMIN' ? 'Administrator' : 'Pro', used: 10, conversionLimit: null, canConvert: true };
    show(); expect(screen.queryByText('Explore Pro')).not.toBeInTheDocument(); expect(screen.getByRole('link', { name: 'New conversion' })).toHaveAttribute('href', '/wizard');
  });
  it('keeps both empty and header actions consistent for an exhausted Starter', () => {
    account.data.plan.canConvert = false; projects.data.sites = []; projects.data.total = 0;
    show(); for (const link of screen.getAllByRole('link', { name: 'Upgrade to Pro' })) expect(link).toHaveAttribute('href', '/checkout');
    expect(screen.queryByRole('link', { name: 'New conversion' })).not.toBeInTheDocument();
  });
  it('filters current-page project status and clears all filters from the empty state', () => {
    show(); fireEvent.change(screen.getByRole('combobox'), { target: { value: 'failed' } });
    expect(screen.queryByRole('link', { name: /Advisory https/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search projects'), { target: { value: 'no match' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByLabelText('Search projects')).toHaveValue(''); expect(screen.getByRole('combobox')).toHaveValue('all');
    expect(screen.getByText('Advisory')).toBeInTheDocument();
  });
});
