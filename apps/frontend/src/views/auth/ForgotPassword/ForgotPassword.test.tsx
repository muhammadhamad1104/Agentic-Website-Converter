import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ForgotPassword from './ForgotPassword';
import api from '../../../services/api';
import { useResource } from '../../../hooks/useResource';
vi.mock('../../../services/api', () => ({ default: { post: vi.fn() } }));
vi.mock('../../../hooks/useResource', () => ({ useResource: vi.fn() }));
vi.mock('../../components/AuthFrame/AuthFrame', () => ({ default: ({ title, children }: any) => <main><h1>{title}</h1>{children}</main> }));
const show = () => render(<MemoryRouter><ForgotPassword /></MemoryRouter>);
describe('Inbox recovery', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(useResource).mockReturnValue({ data: { available: true, supportEmail: null }, error: '', loading: false, refresh: vi.fn() }); vi.mocked(api.post).mockResolvedValue({}); });
  it('requests a link and shows only a generic acknowledgement', async () => {
    show(); fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'member@example.com' } }); fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    await screen.findByText('Check your inbox.'); expect(api.post).toHaveBeenCalledWith('/auth/forgot-password', { email: 'member@example.com' });
    expect(screen.getByRole('status')).toHaveTextContent('If an active account');
  });
  it('never claims email delivery or invents admin contact when SMTP is disabled', () => {
    vi.mocked(useResource).mockReturnValue({ data: { available: false, supportEmail: null }, error: '', loading: false, refresh: vi.fn() }); show();
    expect(screen.getByRole('status')).toHaveTextContent('currently unavailable'); expect(screen.queryByRole('button', { name: 'Send reset link' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Contact support' })).not.toBeInTheDocument();
  });
  it('uses only the configured support address', () => {
    vi.mocked(useResource).mockReturnValue({ data: { available: false, supportEmail: 'support@example.com' }, error: '', loading: false, refresh: vi.fn() }); show();
    expect(screen.getByRole('link', { name: 'Contact support' })).toHaveAttribute('href', 'mailto:support@example.com');
  });
  it('shows retryable API errors without a false success', async () => {
    vi.mocked(api.post).mockRejectedValue({ response: { data: { error: 'Too many recovery attempts.' } } }); show();
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'member@example.com' } }); fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    await screen.findByRole('alert'); expect(screen.getByRole('alert')).toHaveTextContent('Too many recovery attempts.'); expect(screen.queryByText('Check your inbox.')).not.toBeInTheDocument();
  });
});
