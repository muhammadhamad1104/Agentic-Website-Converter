import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Profile from './Profile';
import { useAuthStore } from '../../../store/authStore';
vi.mock('../../../hooks/useResource', () => ({ useResource: () => ({ data: null, error: '', refresh: vi.fn() }), duration: vi.fn() }));
vi.mock('../../components/Workspace/Workspace', () => ({ Workspace: ({ children }: any) => <main>{children}</main>, Metrics: () => null, LoadError: () => null }));
const original = useAuthStore.getState().updateProfileAsync;
const originalPhoto = useAuthStore.getState().updatePhotoAsync;
const update = vi.fn();
const photoUpdate = vi.fn();
const show = () => render(<MemoryRouter><Profile /></MemoryRouter>);
const fill = (confirmation = 'Replacement password 2026') => {
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'Security' }), { button: 0, ctrlKey: false });
  fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'Current password 2026' } });
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'Replacement password 2026' } });
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: confirmation } });
};
describe('Account password settings', () => {
  beforeEach(() => { vi.clearAllMocks(); Element.prototype.scrollIntoView = vi.fn(); update.mockResolvedValue(undefined); photoUpdate.mockResolvedValue(undefined); useAuthStore.setState({ user: { id: 'member', name: 'Member', email: 'member@example.com', role: 'OWNER', plan: 'STARTER', status: 'ACTIVE', mfaEnabled: false, lastLogin: null, createdAt: '', updatedAt: '' }, updateProfileAsync: update, updatePhotoAsync: photoUpdate }); });
  afterEach(() => useAuthStore.setState({ updateProfileAsync: original, updatePhotoAsync: originalPhoto }));
  it.each(['OWNER', 'ADMIN'] as const)('provides secure password changes for %s', async role => {
    useAuthStore.setState({ user: { ...useAuthStore.getState().user!, role } }); show(); fill(); fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    await screen.findByRole('status'); expect(update).toHaveBeenCalledWith({ currentPassword: 'Current password 2026', password: 'Replacement password 2026', confirmPassword: 'Replacement password 2026' });
    expect(screen.getByLabelText('Current password')).toHaveValue(''); expect(screen.getByLabelText('New password')).toHaveValue('');
  });
  it('does not submit mismatched new passwords', () => {
    show(); fill('Different password 2026'); fireEvent.click(screen.getByRole('button', { name: 'Change password' })); expect(update).not.toHaveBeenCalled(); expect(screen.getByRole('alert')).toHaveTextContent('Passwords do not match');
  });
  it('keeps a failed change visible without a false success', async () => {
    update.mockRejectedValue({ response: { data: { error: 'Your current password is incorrect.' } } }); show(); fill(); fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    await screen.findByRole('alert'); expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
  it('submits a device-selected photo and permits picking the same file again', async () => {
    show(); const file = new File(['photo'], 'portrait.png', { type: 'image/png' });
    const picker = screen.getByLabelText('Choose profile photo');
    fireEvent.change(picker, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add photo' })).not.toBeDisabled());
    expect(photoUpdate).toHaveBeenCalledWith(file); expect(picker).toHaveValue('');
    fireEvent.change(picker, { target: { files: [file] } }); await waitFor(() => expect(photoUpdate).toHaveBeenCalledTimes(2));
  });
  it('offers replace and remove controls for a saved portrait', async () => {
    useAuthStore.setState({ user: { ...useAuthStore.getState().user!, avatarUrl: 'data:image/webp;base64,saved' } });
    show(); expect(screen.getByRole('button', { name: 'Change photo' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove profile photo' }));
    await waitFor(() => expect(photoUpdate).toHaveBeenCalledWith(null));
  });
  it('rejects oversized photos before contacting the API', () => {
    show(); const file = new File(['photo'], 'large.png', { type: 'image/png' });
    Object.defineProperty(file, 'size', { value: 5 * 1024 * 1024 + 1 });
    fireEvent.change(screen.getByLabelText('Choose profile photo'), { target: { files: [file] } });
    expect(photoUpdate).not.toHaveBeenCalled(); expect(screen.getByRole('alert')).toHaveTextContent('5 MB or smaller');
  });
  it('leaves upload failures visible with controls available to retry', async () => {
    photoUpdate.mockRejectedValue({ response: { data: { error: 'Choose a valid photo.' } } });
    show(); fireEvent.change(screen.getByLabelText('Choose profile photo'), { target: { files: [new File(['bad'], 'photo.png')] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a valid photo.');
    expect(screen.getByRole('button', { name: 'Add photo' })).not.toBeDisabled();
  });
  it('shows one account section at a time and retains edited profile details between tabs', () => {
    show();
    expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Edited name' } });
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Membership' }), { button: 0, ctrlKey: false });
    expect(screen.getByText('Conversion allowance')).toBeInTheDocument();
    expect(screen.queryByLabelText('Full name')).not.toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Personal details' }), { button: 0, ctrlKey: false });
    expect(screen.getByLabelText('Full name')).toHaveValue('Edited name');
  });
  it('opens the security tab from the admin account-security link', () => {
    render(<MemoryRouter initialEntries={['/profile#security']}><Profile /></MemoryRouter>);
    const tab = screen.getByRole('tab', { name: 'Security' });
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', tab.getAttribute('aria-controls'));
    expect(screen.getByLabelText('Current password')).toBeInTheDocument();
    expect(screen.queryByLabelText('Full name')).not.toBeInTheDocument();
  });
});
