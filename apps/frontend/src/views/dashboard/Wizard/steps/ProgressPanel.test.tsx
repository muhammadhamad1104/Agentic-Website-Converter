import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProgressPanel, { generatedFileCount } from './ProgressPanel';
const copy = vi.fn();
const logs = [{ timestamp: '10:15:00', level: 'info', text: 'Captured page /services' }];
const show = (entries = logs) => render(<ProgressPanel status="running" elapsed="12s" metrics={[{ label: 'Captured pages', value: 4 }]} logs={entries} />);
beforeEach(() => { copy.mockReset().mockResolvedValue(undefined); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } }); });
describe('Live worker activity', () => {
  it('shows supplied telemetry and can pause following the activity stream', () => {
    show(); expect(screen.getByText('4')).toBeInTheDocument(); expect(screen.getByText('12s')).toBeInTheDocument();
    const follow = screen.getByRole('checkbox', { name: 'Follow live' }); expect(follow).toBeChecked(); fireEvent.click(follow); expect(follow).not.toBeChecked();
    expect(screen.getByRole('log', { name: 'Worker activity' })).toHaveTextContent(logs[0].text);
  });
  it('copies actual event content', async () => {
    show(); fireEvent.click(screen.getByRole('button', { name: 'Copy worker activity' }));
    await screen.findByRole('button', { name: 'Activity copied' }); expect(copy).toHaveBeenCalledWith('10:15:00 [info] Captured page /services');
  });
  it('reports a clipboard failure without losing worker activity', async () => {
    copy.mockRejectedValue(new Error('Denied')); show(); fireEvent.click(screen.getByRole('button', { name: 'Copy worker activity' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('could not be copied')); expect(screen.getByRole('log')).toHaveTextContent(logs[0].text);
  });
  it('does not fabricate activity when none has arrived', () => {
    show([]); expect(screen.getByText('Awaiting worker events.')).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Copy worker activity' })).toBeDisabled();
  });
  it('counts unique generated files across nested worker artifacts', () => {
    expect(generatedFileCount({ files: [{ filename: 'index.ts', code: 'one' }, { filename: 'index.ts', code: 'two' }], routes: { entry: { filename: 'routes.ts', code: '' } } })).toBe(2);
  });
});
