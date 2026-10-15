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

const pending = new Map<string, Promise<any>>();
function singleFlight<T>(key: string, action: () => Promise<T>): Promise<T> {
  const existing = pending.get(key);
  if (existing) return existing;
  const request = Promise.resolve().then(action).finally(() => { pending.delete(key); });
  pending.set(key, request);
  return request;
}

export const useJobStore = create<JobState>()(
  devtools(
    (set, get) => ({
      jobs: {},
      currentJobId: null,
      isLoading: false,

      createJob: (payload) => singleFlight('create:' + JSON.stringify(payload), async () => {
        set({ isLoading: true });
        try {
          const { data } = await api.post('/jobs', payload);
          const job: ConversionJob = data.job;
          if (!job?.id) throw new Error('Job ID was not returned.');
          set((state) => ({
            jobs: { ...state.jobs, [job.id]: job },
            currentJobId: job.id,
            isLoading: false,
          }));
          toast.success('Conversion job created.');
          return job;
        } catch (err) {
          set({ isLoading: false });
          throw err;
        }
      }),

      runJob: (jobId) => singleFlight('mutation:' + jobId, async () => {
        await pending.get('read:' + jobId)?.catch(() => {});
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
      }),

      inferSchema: (jobId) => singleFlight('mutation:' + jobId, async () => {
        const job = await get().getJob(jobId);
        const status = String(job.workerJob?.status || '').toLowerCase();
        if (['inferring_schema', 'awaiting_approval', 'schema_proposed', 'approved', 'generating', 'generated', 'validated', 'completed', 'ready'].includes(status) ||
          ['INFERRING_SCHEMA', 'AWAITING_APPROVAL', 'GENERATING', 'COMPLETED', 'READY', 'DONE'].includes(job.status)) return;
        if (!['crawled', 'extracted'].includes(status)) throw new Error('The worker must finish capture before schema analysis.');
        try {
          const { data } = await api.post(`/jobs/${jobId}/infer-schema`);
          set((state) => ({
            jobs: {
              ...state.jobs,
              [jobId]: { ...state.jobs[jobId], ...data.job },
            },
          }));
          toast.success('Schema analysis started.');
        } catch (err) {
          throw err;
        }
      }),

      getJob: (jobId) => singleFlight('read:' + jobId, async () => {
        try {
          const { data } = await api.get(`/jobs/${jobId}`);
          const job: ConversionJob = data.job;
          if (!job?.id) throw new Error('Conversion status was not returned.');
          set((state) => ({
            jobs: { ...state.jobs, [jobId]: job },
          }));
          return job;
        } catch (err) {
          throw err;
        }
      }),

      submitSchemaDecision: (jobId, decision, feedback) => singleFlight('mutation:' + jobId, async () => {
        const job = await get().getJob(jobId);
        const status = String(job.workerJob?.status || '').toLowerCase();
        if (job.workerJob?.schema_decision === 'approved' || ['approved', 'generating', 'generated', 'validated', 'completed', 'ready'].includes(status)) {
          if (decision === 'approved') return;
          throw new Error('The schema was already approved. Reload the conversion.');
        }
        if (!['awaiting_approval', 'schema_proposed'].includes(status)) throw new Error('The schema is no longer awaiting review. Reload the conversion.');
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
              ? 'Schema approved. Generation started.'
              : 'Schema revision requested.',
          );
        } catch (err) {
          throw err;
        }
      }),

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
