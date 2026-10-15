import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import StatusRecovery from './StatusRecovery';

const { runJob } = vi.hoisted(() => ({ runJob: vi.fn() }));
vi.mock('../../../../store/jobStore', () => ({ useJobStore: () => ({ runJob }) }));
beforeEach(() => { runJob.mockReset(); });

it('resumes the same conversion once before refreshing status', async () => {
  let resolve!: () => void;
  runJob.mockReturnValue(new Promise<void>(done => { resolve = done; }));
  const refresh = vi.fn();
  render(<StatusRecovery error="" stopped jobId="existing-job" refresh={refresh} />);
  const resume = screen.getByRole('button', { name: 'Resume conversion' });
  fireEvent.click(resume); fireEvent.click(resume);
  expect(runJob).toHaveBeenCalledOnce();
  expect(runJob).toHaveBeenCalledWith('existing-job');
  expect(refresh).not.toHaveBeenCalled();
  resolve();
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
});

it('keeps failed resumes visible and allows another attempt', async () => {
  runJob.mockRejectedValue(new Error('unavailable'));
  render(<StatusRecovery error="" stopped jobId="existing-job" refresh={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Resume conversion' }));
  expect(await screen.findByText(/Unable to resume/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Resume conversion' })).toBeEnabled();
});
