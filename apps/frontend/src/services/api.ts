import axios, { type AxiosInstance } from 'axios';
import toast from 'react-hot-toast';
import { useAuthStore } from '../store/authStore';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

// ── Axios Instance ───────────────────────────────────────────
const api: AxiosInstance = axios.create({
  baseURL: `${BASE_URL}/api`,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

// ── Request Interceptor ──────────────────────────────────────
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// ── Response Interceptor ─────────────────────────────────────
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    let message =
      error.response?.data?.message ||
      error.response?.data?.error ||
      error.message ||
      'Something went wrong';

    // Simplify database/Prisma errors for non-technical users
    if (typeof message === 'string' && (message.toLowerCase().includes('prisma') || message.toLowerCase().includes('does not exist'))) {
      message = 'Service is currently unavailable. Please try again later.';
    }

    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      useAuthStore.setState({ user: null, isAuthenticated: false, token: null });
      // Only redirect if not already on login or register pages
      const currentPath = window.location.pathname;
      if (currentPath !== '/login' && currentPath !== '/register') {
        window.location.href = '/login';
      }
      
      // Still show the error toast for 401 if they are trying to log in (wrong password)
      toast.error(message, { duration: 4000 });
      return Promise.reject(error);
    }

    if (error.response?.status !== 401) {
      toast.error(message, { duration: 4000 });
    }

    return Promise.reject(error);
  },
);

export default api;
