import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../../../services/api';
import { useResource } from '../../../../hooks/useResource';
import Step1Input from './Step1Input';
import Step2Config from './Step2Config';

const { createSite, uploadZip } = vi.hoisted(() => ({ createSite: vi.fn(), uploadZip: vi.fn() }));
vi.mock('../../../../store/siteStore', () => ({ useSiteStore: () => ({ createSite, uploadZip }) }));
vi.mock('../../../../services/api', () => ({ default: { post: vi.fn() } }));
vi.mock('../../../../hooks/useResource', () => ({ useResource: vi.fn() }));
vi.mock('./ConversionVisual', () => ({ default: () => <div data-testid="conversion-visual" /> }));
const source = 'https://www.nowwadvisory.co.nz';
const account = { plan: { name: 'Starter', remaining: 5, canConvert: true } };
const showInput = (next = vi.fn()) => render(<Step1Input onNext={next} setJobId={vi.fn()} setTargetUrl={vi.fn()} setSiteId={vi.fn()} />);
const showSettings = () => render(<MemoryRouter><Step2Config onNext={vi.fn()} onBack={vi.fn()} setJobId={vi.fn()} targetUrl={source} siteId="site-1" /></MemoryRouter>);
beforeEach(() => {
  vi.clearAllMocks(); createSite.mockResolvedValue({ id: 'site-1' });
  vi.mocked(api.post).mockResolvedValue({ data: { valid: true, job: { id: 'job-1' } } });
  vi.mocked(useResource).mockReturnValue({ data: account, error: '', loading: false, refresh: vi.fn() } as any);
});
describe('Converter source and capture settings', () => {
  it('uploads the selected ZIP and advances only after server validation', async () => {
    const next = vi.fn(); showInput(next);
    uploadZip.mockResolvedValue({ id: 'zip-site', sourceUrl: 'website.zip' });
    fireEvent.click(screen.getByRole('radio', { name: 'ZIP archive' }));
    expect(screen.queryByLabelText('Static website URL')).not.toBeInTheDocument();
    const file = new File(['zip'], 'website.zip', { type: 'application/zip' });
    fireEvent.change(screen.getByLabelText('Static website ZIP'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue to settings' }));
    await waitFor(() => expect(next).toHaveBeenCalledOnce());
    expect(uploadZip).toHaveBeenCalledWith(file, expect.any(Function));
    expect(createSite).not.toHaveBeenCalled();
  });
  it('keeps a rejected archive visible without advancing', async () => {
    const next = vi.fn(); showInput(next);
    uploadZip.mockRejectedValue({ response: { data: { error: 'ZIP contains server-side files' } } });
    fireEvent.click(screen.getByRole('radio', { name: 'ZIP archive' }));
    fireEvent.change(screen.getByLabelText('Static website ZIP'), { target: { files: [new File(['zip'], 'bad.zip')] } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue to settings' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('server-side files');
    expect(next).not.toHaveBeenCalled();
  });
  it('captures a complete archive without sending a filename as a URL', async () => {
    render(<MemoryRouter><Step2Config onNext={vi.fn()} onBack={vi.fn()} setJobId={vi.fn()} targetUrl="website.zip" siteId="zip-site" sourceType="ZIP" /></MemoryRouter>);
    expect(screen.queryByRole('radio', { name: 'Quick scan' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start conversion' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/jobs', {
      siteId: 'zip-site', crawlDepth: 3, fullSite: true, maxPages: 0, maxAssets: 0, extractImages: true, inferRelations: true,
    }));
  });
  it('keeps classification authoritative before project creation', async () => {
    const next = vi.fn(); showInput(next);
    fireEvent.change(screen.getByLabelText('Static website URL'), { target: { value: 'www.nowwadvisory.co.nz' } });
    expect(screen.getByRole('button', { name: 'Continue to settings' })).toBeDisabled();
    await screen.findByText('Static website verified');
    fireEvent.click(screen.getByRole('button', { name: 'Continue to settings' }));
    await waitFor(() => expect(next).toHaveBeenCalledOnce());
    expect(api.post).toHaveBeenCalledWith('/sites/validate-url', { url: source }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(createSite).toHaveBeenCalledWith({ sourceUrl: source, name: '', sourceType: 'URL' });
  });
  it('keeps dynamic websites blocked by the original classifier response', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { valid: false, error: 'Dynamic websites are not supported.' } });
    showInput(); fireEvent.change(screen.getByLabelText('Static website URL'), { target: { value: source } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Dynamic websites are not supported');
    expect(screen.getByRole('button', { name: 'Continue to settings' })).toBeDisabled(); expect(createSite).not.toHaveBeenCalled();
  });
  it('retains full-site and unlimited-media capture as the default', async () => {
    showSettings(); expect(screen.getByRole('radio', { name: 'Full website' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Start conversion' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/jobs', {
      siteId: 'site-1', url: source, crawlDepth: 3, fullSite: true, maxPages: 0, maxAssets: 0, extractImages: true, inferRelations: true,
    }));
  });
  it('submits the selected quick-scan limits without changing the contract', async () => {
    showSettings(); fireEvent.click(screen.getByRole('radio', { name: 'Quick scan' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start conversion' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/jobs', expect.objectContaining({ crawlDepth: 1, fullSite: false, maxPages: 20, maxAssets: 0 })));
  });
  it('keeps exhausted Starter accounts blocked by account data', () => {
    vi.mocked(useResource).mockReturnValue({ data: { plan: { name: 'Starter', remaining: 0, canConvert: false } }, error: '', loading: false, refresh: vi.fn() } as any);
    showSettings(); expect(screen.getByRole('button', { name: 'Start conversion' })).toBeDisabled(); expect(screen.getByRole('link', { name: 'Upgrade to Pro' })).toHaveAttribute('href', '/checkout');
  });
  it.each(['Pro', 'Administrator'])('allows unlimited %s access without inventing an allowance', name => {
    vi.mocked(useResource).mockReturnValue({ data: { plan: { name, remaining: null, canConvert: true } }, error: '', loading: false, refresh: vi.fn() } as any);
    showSettings(); expect(screen.getByText('Unlimited conversions')).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Start conversion' })).toBeEnabled();
  });
  it('leaves a failed job request visible and retryable', async () => {
    vi.mocked(api.post).mockRejectedValue({ response: { data: { error: 'Worker unavailable.' } } });
    showSettings(); fireEvent.click(screen.getByRole('button', { name: 'Start conversion' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Worker unavailable');
    expect(screen.getByRole('button', { name: 'Start conversion' })).toBeEnabled();
  });
});
