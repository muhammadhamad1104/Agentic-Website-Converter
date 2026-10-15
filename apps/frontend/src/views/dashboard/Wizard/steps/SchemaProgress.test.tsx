import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Step4Schema from './Step4Schema';

const mocks = vi.hoisted(() => ({ getJob: vi.fn(), inferSchema: vi.fn() }));
vi.mock('../../../../store/jobStore', () => ({ useJobStore: () => mocks }));
beforeEach(() => { vi.clearAllMocks(); });

describe('Schema inference progress', () => {
  it('shows persisted evidence progress while inference is still running', async () => {
    mocks.getJob.mockResolvedValue({ status: 'INFERRING_SCHEMA', workerJob: {
      status: 'inferring_schema', schema_quality_report: { inference_progress: {
        completed_batches: 3, total_batches: 9, entity_count: 13, field_count: 52,
      } }, trace_events: [{ node: 'infer_schema', message: 'Analyzing page 4/8, evidence batch 4/9.' }],
    } });
    render(<Step4Schema jobId="job" onNext={vi.fn()} />);
    expect(await screen.findByText('3 / 9')).toBeInTheDocument();
    expect(screen.getByText('13')).toBeInTheDocument();
    expect(screen.getByText('52')).toBeInTheDocument();
    expect(screen.getByRole('log')).toHaveTextContent('Analyzing page 4/8');
    expect(screen.getByRole('button', { name: 'Review schema' })).toBeDisabled();
    expect(mocks.inferSchema).not.toHaveBeenCalled();
  });

  it('does not treat a failed schema with partial entities as approved for review', async () => {
    mocks.getJob.mockResolvedValue({ status: 'FAILED', workerJob: {
      status: 'failed', schema_proposal: { entities: [{ name: 'Service', fields: [] }] },
      errors: ['All LLM providers failed. Check quota.'],
    } });
    render(<Step4Schema jobId="job" onNext={vi.fn()} />);
    expect(await screen.findByText(/All LLM providers failed/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review schema' })).toBeDisabled();
  });

  it('enables review only when the worker reports a finished schema', async () => {
    mocks.getJob.mockResolvedValue({ status: 'INFERRING_SCHEMA', workerJob: {
      status: 'awaiting_approval', schema_proposal: { entities: [{ name: 'Service', fields: [{ name: 'title' }] }] },
    } });
    render(<Step4Schema jobId="job" onNext={vi.fn()} />);
    await screen.findByText(/1 model\(s\) ready for review/);
    expect(screen.getByRole('button', { name: 'Review schema' })).toBeEnabled();
  });
});
