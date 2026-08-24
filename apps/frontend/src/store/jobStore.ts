import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { ConversionJob, CreateJobPayload } from '../types/job';
import api from '../services/api';
import toast from 'react-hot-toast';

interface JobState {
  jobs: Record<string, ConversionJob>;
  currentJobId: string | null;
  isLoading: boolean;

  // Actions
  createJob: (payload: CreateJobPayload) => Promise<ConversionJob>;
  runJob: (jobId: string) => Promise<void>;
  inferSchema: (jobId: string) => Promise<void>;
  getJob: (jobId: string) => Promise<ConversionJob>;
  submitSchemaDecision: (jobId: string, decision: 'approved' | 'rejected', feedback?: any) => Promise<void>;
  exportJob: (jobId: string) => Promise<{ url: string }>;
  setCurrentJob: (jobId: string | null) => void;
  updateJobLocally: (jobId: string, updates: Partial<ConversionJob>) => void;
}

export const useJobStore = create<JobState>()(
  devtools(
    (set) => ({
      jobs: {},
      currentJobId: null,
      isLoading: false,

      createJob: async (payload) => {
        set({ isLoading: true });
        try {
          const { data } = await api.post('/jobs', payload);
          const job: ConversionJob = data.job;
          set((state) => ({
            jobs: { ...state.jobs, [job.id]: job },
            currentJobId: job.id,
            isLoading: false,
          }));
          toast.success('Conversion job created! 🤖');
          return job;
        } catch (err) {
          set({ isLoading: false });
          throw err;
        }
      },

      runJob: async (jobId) => {
        set({ isLoading: true });
        try {
          const { data } = await api.post(`/jobs/${jobId}/run`);
          set((state) => ({
            jobs: {
              ...state.jobs,
              [jobId]: { ...state.jobs[jobId], ...data.job },
            },
            isLoading: false,
          }));
        } catch (err) {
          set({ isLoading: false });
          throw err;
        }
      },

      inferSchema: async (jobId) => {
        try {
          const { data } = await api.post(`/jobs/${jobId}/infer-schema`);
          set((state) => ({
            jobs: {
              ...state.jobs,
              [jobId]: { ...state.jobs[jobId], ...data.job },
            },
          }));
          toast.success('Analyzing website structure & inferring schema...');
        } catch (err) {
          toast.error('Failed to trigger schema inference');
        }
      },

      getJob: async (jobId) => {
        try {
          const { data } = await api.get(`/jobs/${jobId}`);
          const job: ConversionJob = data.job;
          set((state) => ({
            jobs: { ...state.jobs, [jobId]: job },
          }));
          return job;
        } catch (err) {
          throw err;
        }
      },

      submitSchemaDecision: async (jobId, decision, feedback) => {
        try {
          const { data } = await api.post(`/jobs/${jobId}/schema-decision`, { decision, feedback });
          set((state) => ({
            jobs: {
              ...state.jobs,
              [jobId]: { ...state.jobs[jobId], ...data.job },
            },
          }));
          toast.success(
            decision === 'approved'
              ? '✅ Schema approved! Generating code...'
              : '🔄 Schema rejected. Re-analyzing...',
          );
        } catch (err) {
          throw err;
        }
      },

      exportJob: async (jobId) => {
        try {
          const { data } = await api.post(`/jobs/${jobId}/export`);
          toast.success('📦 Package exported successfully!');
          return data;
        } catch (err) {
          throw err;
        }
      },

      setCurrentJob: (jobId) => set({ currentJobId: jobId }),

      updateJobLocally: (jobId, updates) => {
        set((state) => ({
          jobs: {
            ...state.jobs,
            [jobId]: { ...state.jobs[jobId], ...updates },
          },
        }));
      },
    }),
    { name: 'JobStore' },
  ),
);
