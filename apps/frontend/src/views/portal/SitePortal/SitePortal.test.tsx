import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SitePortal from './SitePortal';
import { useResource } from '../../../hooks/useResource';
import { usePreview } from '../../../hooks/usePreview';
import api from '../../../services/api';

vi.mock('../../../hooks/useResource', async importOriginal => ({ ...await importOriginal<object>(), useResource: vi.fn() }));
vi.mock('../../../hooks/usePreview', () => ({ usePreview: vi.fn() }));
vi.mock('../../../services/api', () => ({ default: { get: vi.fn(), delete: vi.fn() } }));
vi.mock('../../components/Workspace/Workspace', async importOriginal => ({ ...await importOriginal<object>(), Workspace: ({ children }: any) => <main>{children}</main> }));
let project: any;
let preview: any;
const show = () => render(<MemoryRouter initialEntries={['/sites/project']}><Routes><Route path="/sites/:id" element={<SitePortal />} /></Routes></MemoryRouter>);
describe('Converted application workspace', () => {
  beforeEach(() => {
    project = { site: { id: 'project', name: 'Advisory', sourceUrl: 'https://example.com', status: 'READY', createdAt: '2026-10-01', crawls: [{ id: 'job' }], hasArtifacts: true, workerAvailable: true, entities: [], traceEvents: [], validation: { issues: [{ message: 'A build warning' }] } }, stats: { pages: 12, assets: 34, models: 2, editableFields: 8, durationMs: 75000 } };
    preview = { status: 'stopped', start: vi.fn(), stop: vi.fn() };
    vi.mocked(usePreview).mockImplementation(() => preview);
    vi.mocked(useResource).mockReturnValue({ data: project, error: '', loading: false, refresh: vi.fn() });
  });
  it('does not start a server until preview is explicitly requested', () => {
    show(); expect(usePreview).toHaveBeenCalledWith('job'); expect(preview.start).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Start preview' })); expect(preview.start).toHaveBeenCalledTimes(1);
  });
  it('never blocks export because of validation notices', () => {
    show(); expect(screen.getByRole('button', { name: 'Download' })).toBeEnabled(); expect(screen.getByText('1 validation notices')).toBeInTheDocument();
  });
  it('keeps preview disabled before artifacts exist', () => {
    project.site.hasArtifacts = false; show(); expect(screen.getByRole('button', { name: 'Start preview' })).toBeDisabled();
  });
  it('renders the actual running preview and provides a stop control', () => {
    preview.status = 'ready'; preview.url = 'http://localhost:5001/generated-preview'; show();
    expect(screen.getByTitle('Advisory preview')).toHaveAttribute('src', preview.url);
    fireEvent.click(screen.getByRole('button', { name: 'Stop' })); expect(preview.stop).toHaveBeenCalledTimes(1);
  });
  it('shows concrete preview startup progress instead of an indefinite spinner', () => {
    preview = { status: 'starting', stage: 'build', message: 'Building the generated interface', progress: 82, elapsedSeconds: 34,
      start: vi.fn(), stop: vi.fn() };
    show();
    expect(screen.getByText('Building the generated interface')).toBeInTheDocument();
    expect(screen.getByText('34s elapsed')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Preview startup progress' })).toHaveAttribute('aria-valuenow', '82');
  });
  it('requires an exact name before permitting project deletion', () => {
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute('open', ''); });
    show(); fireEvent.click(screen.getByRole('button', { name: 'Delete project' }));
    const button = screen.getByRole('button', { name: 'Delete' }); expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Project name confirmation'), { target: { value: 'advisory' } }); expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Project name confirmation'), { target: { value: 'Advisory' } }); expect(button).toBeEnabled(); expect(api.delete).not.toHaveBeenCalled();
  });
  it('keeps project views separate without starting a preview when browsing details', () => {
    project.site.entities = [{ name: 'Service', fields: [{ name: 'title', type: 'string' }] }];
    show(); expect(screen.queryByText('Service')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Start preview' })).toHaveLength(1);
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Content schema' }), { button: 0, ctrlKey: false });
    expect(screen.getByText('Service')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start preview' })).not.toBeInTheDocument();
    expect(preview.start).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Activity' }), { button: 0, ctrlKey: false });
    expect(screen.getByText('No worker events are available.')).toBeInTheDocument();
  });
});
