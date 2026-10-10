import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../services/api';
import { useAuthStore } from './authStore';
vi.mock('../services/api', () => ({ default: { put: vi.fn(), get: vi.fn(), delete: vi.fn() } }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn() } }));
describe('Password change token rotation', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); useAuthStore.setState({ user: { id: 'member', name: 'Member', email: 'member@example.com', role: 'OWNER', plan: 'STARTER', status: 'ACTIVE', mfaEnabled: false, lastLogin: null, createdAt: '', updatedAt: '' }, token: 'old', isAuthenticated: true, isLoading: false }); });
  it('replaces the current session token without persisting passwords', async () => {
    vi.mocked(api.put).mockResolvedValue({ data: { user: { name: 'Member' }, token: 'new-session-token' } });
    await useAuthStore.getState().updateProfileAsync({ password: 'New secure password 2026', currentPassword: 'Old secure password 2026', confirmPassword: 'New secure password 2026' });
    expect(useAuthStore.getState().token).toBe('new-session-token'); expect(localStorage.getItem('token')).toBe('new-session-token');
    expect(localStorage.getItem('auth-store')).not.toContain('New secure password'); expect(localStorage.getItem('auth-store')).not.toContain('Old secure password');
  });
  it.each(['success', 'failure'])('ignores a stale account fetch after token rotation (%s)', async outcome => {
    localStorage.setItem('token', 'old-session');
    let resolve!: (value: any) => void; let reject!: (error: any) => void;
    vi.mocked(api.get).mockImplementation(() => new Promise((done, fail) => { resolve = done; reject = fail; }));
    const pending = useAuthStore.getState().fetchMe();
    localStorage.setItem('token', 'new-session'); useAuthStore.setState({ token: 'new-session', isAuthenticated: true, isLoading: false });
    if (outcome === 'success') resolve({ data: { user: { name: 'Stale account' } } }); else reject(new Error('Revoked session'));
    await pending;
    expect(useAuthStore.getState().token).toBe('new-session'); expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().user?.name).toBe('Member'); expect(localStorage.getItem('token')).toBe('new-session');
  });
  it('uploads multipart photos and only updates the portrait', async () => {
    const file = new File(['photo'], 'portrait.png', { type: 'image/png' });
    vi.mocked(api.put).mockResolvedValue({ data: { user: { name: 'Stale name', avatarUrl: 'data:image/webp;base64,saved' } } });
    await useAuthStore.getState().updatePhotoAsync(file);
    const [url, body, config] = vi.mocked(api.put).mock.calls[0];
    expect(url).toBe('/auth/avatar'); expect((body as FormData).get('photo')).toBe(file);
    expect(config?.headers?.['Content-Type']).toBeUndefined();
    expect(useAuthStore.getState().user?.avatarUrl).toBe('data:image/webp;base64,saved');
    expect(useAuthStore.getState().user?.name).toBe('Member');
  });
  it('removes the persisted photo through the account API', async () => {
    vi.mocked(api.delete).mockResolvedValue({ data: { user: { avatarUrl: null } } });
    await useAuthStore.getState().updatePhotoAsync(null);
    expect(api.delete).toHaveBeenCalledWith('/auth/avatar'); expect(useAuthStore.getState().user?.avatarUrl).toBeNull();
  });
  it('restores the photo from a new authenticated account fetch', async () => {
    localStorage.setItem('token', 'old');
    vi.mocked(api.get).mockResolvedValue({ data: { user: { ...useAuthStore.getState().user, avatarUrl: 'data:image/webp;base64,persisted' } } });
    await useAuthStore.getState().fetchMe();
    expect(useAuthStore.getState().user?.avatarUrl).toBe('data:image/webp;base64,persisted');
  });
  it('never applies an upload response to a different signed-in account', async () => {
    let finish!: (value: any) => void;
    vi.mocked(api.put).mockImplementation(() => new Promise(done => { finish = done; }));
    const pending = useAuthStore.getState().updatePhotoAsync(new File(['photo'], 'photo.png'));
    useAuthStore.setState({ user: { ...useAuthStore.getState().user!, id: 'another', avatarUrl: null } });
    finish({ data: { user: { avatarUrl: 'wrong-account-photo' } } });
    await expect(pending).rejects.toThrow('Your account changed'); expect(useAuthStore.getState().user?.avatarUrl).toBeNull();
  });
});
