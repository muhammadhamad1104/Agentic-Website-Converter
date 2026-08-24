import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { Site, CreateSitePayload, DashboardStats, AnalyticsData } from '../types/site';
import api from '../services/api';
import toast from 'react-hot-toast';

interface SiteState {
  sites: Site[];
  currentSite: Site | null;
  stats: DashboardStats | null;
  analytics: AnalyticsData | null;
  isLoading: boolean;
  totalCount: number;

  // Actions
  fetchSites: (page?: number, limit?: number) => Promise<void>;
  fetchSite: (id: string) => Promise<void>;
  createSite: (payload: CreateSitePayload) => Promise<Site>;
  deleteSite: (id: string) => Promise<void>;
  fetchStats: () => Promise<void>;
  fetchAnalytics: () => Promise<void>;
  setCurrentSite: (site: Site | null) => void;
}

export const useSiteStore = create<SiteState>()(
  devtools(
    (set) => ({
      sites: [],
      currentSite: null,
      stats: null,
      analytics: null,
      isLoading: false,
      totalCount: 0,

      fetchSites: async (page = 1, limit = 20) => {
        set({ isLoading: true });
        try {
          const { data } = await api.get('/sites', { params: { page, limit } });
          set({ sites: data.sites, totalCount: data.total, isLoading: false });
        } catch {
          set({ isLoading: false });
        }
      },

      fetchSite: async (id) => {
        set({ isLoading: true });
        try {
          const { data } = await api.get(`/sites/${id}`);
          set({ currentSite: { ...data.site, stats: data.stats }, isLoading: false });
        } catch {
          set({ isLoading: false });
        }
      },

      createSite: async (payload) => {
        set({ isLoading: true });
        try {
          const { data } = await api.post('/sites', { ...payload, url: payload.sourceUrl });
          const site: Site = data.site;
          set((state) => ({
            sites: [site, ...state.sites],
            isLoading: false,
          }));
          toast.success('Site created successfully! 🎉');
          return site;
        } catch (err) {
          set({ isLoading: false });
          throw err;
        }
      },

      deleteSite: async (id) => {
        try {
          await api.delete(`/sites/${id}`);
          set((state) => ({
            sites: state.sites.filter((s) => s.id !== id),
            totalCount: state.totalCount > 0 ? state.totalCount - 1 : 0
          }));
          toast.success('Site deleted');
        } catch (err) {
          throw err;
        }
      },

      fetchStats: async () => {
        try {
          const { data } = await api.get('/analytics/dashboard');
          set({ stats: data.stats });
        } catch {
          // Silently fail for stats
        }
      },

      fetchAnalytics: async () => {
        try {
          const { data } = await api.get('/analytics/data');
          set({ analytics: data.analytics });
        } catch {
          // Silently fail
        }
      },

      setCurrentSite: (site) => set({ currentSite: site }),
    }),
    { name: 'SiteStore' },
  ),
);
