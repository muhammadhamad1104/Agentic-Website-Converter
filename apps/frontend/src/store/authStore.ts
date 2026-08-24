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
  updateProfileAsync: (payload: { name?: string; password?: string }) => Promise<void>;
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
            set({ user: data.user, isAuthenticated: true, token: storedToken, isLoading: false });
          } catch {
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
            get().updateUser(data.user);
            set({ isLoading: false });
            toast.success('Profile updated successfully!');
          } catch (err) {
            set({ isLoading: false });
            throw err;
          }
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
