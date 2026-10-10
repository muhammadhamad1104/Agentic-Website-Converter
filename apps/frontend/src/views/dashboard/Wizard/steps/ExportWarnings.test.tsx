import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import Step6Generate from './Step6Generate';
import Step7Export from './Step7Export';

const { getJob } = vi.hoisted(() => ({ getJob: vi.fn() }));
vi.mock('../../../../store/jobStore', () => ({ useJobStore: () => ({ getJob }) }));

beforeEach(() => getJob.mockReset());

describe('Best-effort export', () => {
  it('allows download navigation after a failed build when files exist', async () => {
    getJob.mockResolvedValue({ status: 'FAILED', workerJob: {
      status: 'failed', generated_artifacts: { backend: { files: [] } },
      validation_report: { validation_gate: 'blocked', build_status: 'failed',
        issues: [{ severity: 'blocker', message: 'Build failed' }] },
    } });
    const next = vi.fn();
    render(<Step6Generate jobId="job-1" onNext={next} />);
    const button = await screen.findByRole('button', { name: /Proceed to Download/ });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(next).toHaveBeenCalledOnce();
    expect(screen.getByText('FILES AVAILABLE')).toBeInTheDocument();
  });

  it('does not promise a download when no files were generated', async () => {
    getJob.mockResolvedValue({ status: 'FAILED', workerJob: { status: 'failed', generated_artifacts: {} } });
    render(<Step6Generate jobId="job-2" onNext={vi.fn()} />);
    expect(await screen.findByRole('button', { name: 'No files available' })).toBeDisabled();
  });

  it('keeps validated output with source warnings downloadable', async () => {
    getJob.mockResolvedValue({ workerJob: {
      status: 'validated', generated_artifacts: { frontend: { files: [] } },
      validation_report: { validation_gate: 'open', build_status: 'passed',
        issues: [{ severity: 'warning', message: 'Source script unavailable' }] },
    } });
    render(<Step6Generate jobId="job-3" onNext={vi.fn()} />);
    expect(await screen.findByRole('button', { name: /Proceed to Download/ })).toBeEnabled();
    expect(screen.getByText('FILES AVAILABLE')).toBeInTheDocument();
  });

  it('shows validation warnings without claiming deployment readiness', async () => {
    getJob.mockResolvedValue({ workerJob: {
      status: 'failed', generated_artifacts: { backend: {} },
      validation_report: { validation_gate: 'blocked', build_status: 'failed',
        issues: [{ severity: 'blocker', message: 'Source page unavailable' }] },
    } });
    render(<MemoryRouter><Step7Export jobId="job-4" /></MemoryRouter>);
    expect(await screen.findByText('Source page unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Download Source Code/ })).toBeEnabled();
    expect(screen.queryByText('Ready to Deploy')).not.toBeInTheDocument();
  });
});
