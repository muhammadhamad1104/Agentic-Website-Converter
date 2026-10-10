import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ResetPassword from './ResetPassword';
import api from '../../../services/api';
import { useAuthStore } from '../../../store/authStore';
vi.mock('../../../services/api', () => ({ default: { post: vi.fn() } }));
vi.mock('../../components/AuthFrame/AuthFrame', () => ({ default: ({ title, children }: any) => <main><h1>{title}</h1>{children}</main> }));
const raw = 'b'.repeat(64);
function CurrentLocation() { return <output data-testid="location">{useLocation().hash}</output>; }
const show = (token = raw) => render(<MemoryRouter initialEntries={['/reset-password' + (token ? '#token=' + token : '')]}><ResetPassword /><CurrentLocation /></MemoryRouter>);
const fill = (confirm = 'Secure replacement 2026') => { fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'Secure replacement 2026' } }); fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: confirm } }); };
describe('Single-use password link', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(api.post).mockResolvedValue({}); });
  it('removes the token from the URL while keeping it in form memory', async () => {
    show(); expect(screen.getByTestId('location')).toBeEmptyDOMElement(); fill(); fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));
    await screen.findByText('A fresh start.'); expect(api.post).toHaveBeenCalledWith('/auth/reset-password', { token: raw, password: 'Secure replacement 2026', confirmPassword: 'Secure replacement 2026' });
    expect(useAuthStore.getState().isAuthenticated).toBe(false); expect(localStorage.getItem('token')).toBeNull();
  });
  it('does not offer a reset form without a valid-format link', () => {
    show(''); expect(screen.getByRole('alert')).toHaveTextContent('invalid or expired'); expect(screen.queryByRole('button', { name: 'Reset password' })).not.toBeInTheDocument();
  });
  it('requires matching confirmation before contacting the server', () => {
    show(); fill('Different replacement 2026'); fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Passwords do not match'); expect(api.post).not.toHaveBeenCalled();
  });
  it('displays expired or replayed link errors and offers a fresh link', async () => {
    vi.mocked(api.post).mockRejectedValue({ response: { data: { error: 'This reset link is invalid or expired.' } } }); show(); fill(); fireEvent.click(screen.getByRole('button', { name: 'Reset password' }));
    await screen.findByRole('alert'); expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute('href', '/forgot-password');
    expect(screen.queryByText('A fresh start.')).not.toBeInTheDocument();
  });
});
