import { create } from 'zustand';
import { persist, devtools } from 'zustand/middleware';
import type { User, LoginPayload, RegisterPayload } from '../types/auth';
import api from '../services/api';
import toast from 'react-hot-toast';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  token: string | null;

  // Actions
  login: (payload: LoginPayload) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  logout: () => void;
  fetchMe: () => Promise<void>;
  updateUser: (user: Partial<User>) => void;
  updatePhotoAsync: (file: File | null) => Promise<void>;
  updateProfileAsync: (payload: { name?: string; password?: string; currentPassword?: string; confirmPassword?: string }) => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  devtools(
    persist(
      (set, get) => ({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        token: null,

        login: async (payload) => {
          set({ isLoading: true });
          try {
            const { data } = await api.post('/auth/login', payload);
            const { user, token } = data;

            localStorage.setItem('token', token);

            set({ user, isAuthenticated: true, token, isLoading: false });
            toast.success(`Welcome back, ${user.name}!`);
          } catch (err) {
            set({ isLoading: false });
            throw err;
          }
        },

        register: async (payload) => {
          set({ isLoading: true });
          try {
            const { data } = await api.post('/auth/register', payload);
            const { user, token } = data;

            localStorage.setItem('token', token);

            set({ user, isAuthenticated: true, token, isLoading: false });
            toast.success(`Account created successfully!`);
          } catch (err) {
            set({ isLoading: false });
            throw err;
          }
        },

        logout: () => {
          localStorage.removeItem('token');
          set({ user: null, isAuthenticated: false, token: null });
          toast.success('Logged out successfully');
          window.location.href = '/';
        },

        fetchMe: async () => {
          const storedToken = localStorage.getItem('token');
          if (!storedToken) {
            set({ user: null, isAuthenticated: false, token: null, isLoading: false });
            return;
          }

          set({ isLoading: true, token: storedToken });
          try {
            const { data } = await api.get('/auth/me');
            if (localStorage.getItem('token') !== storedToken) return;
            set({ user: data.user, isAuthenticated: true, token: storedToken, isLoading: false });
          } catch {
            if (localStorage.getItem('token') !== storedToken) return;
            localStorage.removeItem('token');
            set({ user: null, isAuthenticated: false, token: null, isLoading: false });
          }
        },

        updateUser: (updates) => {
          const { user } = get();
          if (user) set({ user: { ...user, ...updates } });
        },

        updateProfileAsync: async (payload) => {
          set({ isLoading: true });
          try {
            const { data } = await api.put('/auth/profile', payload);
            if (data.token) { localStorage.setItem('token', data.token); set({ token: data.token }); }
            get().updateUser(data.user);
            set({ isLoading: false });
            toast.success('Profile updated successfully!');
          } catch (err) {
            set({ isLoading: false });
            throw err;
          }
        },

        updatePhotoAsync: async (file) => {
          const accountId = get().user?.id;
          const body = new FormData();
          if (file) body.append('photo', file);
          const { data } = file ? await api.put('/auth/avatar', body, { headers: { 'Content-Type': undefined } }) : await api.delete('/auth/avatar');
          if (get().user?.id !== accountId) throw new Error('Your account changed. Sign in again before retrying.');
          get().updateUser({ avatarUrl: data.user.avatarUrl });
          toast.success(file ? 'Profile photo updated.' : 'Profile photo removed.');
        },
      }),
      {
        name: 'auth-store',
        partialize: (state) => ({
          user: state.user,
          isAuthenticated: state.isAuthenticated,
          token: state.token,
        }),
        onRehydrateStorage: () => (state) => {
          const storedToken = localStorage.getItem('token');
          if (!storedToken || !state?.token) {
            useAuthStore.setState({ user: null, isAuthenticated: false, token: null });
          }
        },
      },
    ),
    { name: 'AuthStore' },
  ),
);
