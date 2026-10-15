import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Step5Approve from './Step5Approve';

const { getJob, submitSchemaDecision } = vi.hoisted(() => ({ getJob: vi.fn(), submitSchemaDecision: vi.fn() }));
vi.mock('../../../../store/jobStore', () => ({ useJobStore: () => ({ getJob, submitSchemaDecision }) }));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn() } }));
const schema = { entities: [{ name: 'Service', fields: [{ name: 'title', type: 'string', required: true }] }] };
beforeEach(() => {
  getJob.mockReset().mockResolvedValue({ status: 'AWAITING_APPROVAL', workerJob: { status: 'awaiting_approval', schema_proposal: schema } });
  submitSchemaDecision.mockReset();
});

describe('Schema approval', () => {
  it('stays on review when the worker rejects the approval request', async () => {
    submitSchemaDecision.mockRejectedValue(new Error('Worker unavailable'));
    const next = vi.fn();
    render(<Step5Approve jobId="job-1" onNext={next} onBack={vi.fn()} />);
    await screen.findByText('Service');
    fireEvent.click(screen.getByRole('button', { name: 'Approve and generate' }));
    await waitFor(() => expect(submitSchemaDecision).toHaveBeenCalledWith('job-1', 'approved', undefined));
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Approve and generate' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Reload schema' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Approve and generate' })).toBeEnabled());
    expect(next).not.toHaveBeenCalled();
  });

  it('shows the original proposal and passes it back with revision notes', async () => {
    submitSchemaDecision.mockResolvedValue(undefined);
    const back = vi.fn();
    render(<Step5Approve jobId="job-2" onNext={vi.fn()} onBack={back} />);
    await screen.findByText('Service');
    fireEvent.click(screen.getByRole('button', { name: 'Schema JSON' }));
    expect(document.querySelector('pre')?.textContent).toBe(JSON.stringify(schema, null, 2));
    expect(document.querySelector('pre')?.textContent).not.toContain('createdAt');
    fireEvent.change(screen.getByLabelText('Revision notes'), { target: { value: 'Add service description' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request revision' }));
    await waitFor(() => expect(back).toHaveBeenCalledOnce());
    expect(submitSchemaDecision).toHaveBeenCalledWith('job-2', 'rejected', { previous_schema: schema, feedback_text: 'Add service description' });
  });
  it('displays property-based models without altering the approved proposal', async () => {
    const proposal = { models: [{ name: 'Page', properties: { title: { type: 'string' }, published: { type: 'boolean' } }, required: ['title'] }] };
    getJob.mockResolvedValue({ status: 'AWAITING_APPROVAL', workerJob: { status: 'awaiting_approval', schema_proposal: proposal } });
    render(<Step5Approve jobId="job-3" onNext={vi.fn()} onBack={vi.fn()} />);
    await screen.findByText('Page'); expect(screen.getByText('title')).toBeInTheDocument(); expect(screen.getByText('boolean')).toBeInTheDocument(); expect(screen.getByText('Yes')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Schema JSON' })); expect(document.querySelector('pre')?.textContent).toBe(JSON.stringify(proposal, null, 2));
  });
  it('reloads a schema after a fetch failure', async () => {
    getJob.mockRejectedValueOnce(new Error('Offline')).mockResolvedValue({ status: 'AWAITING_APPROVAL', workerJob: { status: 'awaiting_approval', schema_proposal: schema } });
    render(<Step5Approve jobId="job-4" onNext={vi.fn()} onBack={vi.fn()} />);
    await screen.findByRole('alert'); fireEvent.click(screen.getByRole('button', { name: 'Reload schema' })); await screen.findByText('Service'); expect(getJob).toHaveBeenCalledTimes(2);
  });
});
