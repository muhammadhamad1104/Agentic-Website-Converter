import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../services/api';

export function useResource<T>(path: string, interval = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const previousPath = useRef(path);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    let active = true;
    let running = false;
    const controller = new AbortController();
    if (previousPath.current !== path) { setData(null); setError(''); previousPath.current = path; }
    setLoading(true);
    const load = async () => {
      if (running) return;
      running = true;
      try {
        const result = await api.get(path, { signal: controller.signal });
        if (active) { setData(result.data); setError(''); }
      } catch (problem: any) {
        if (active) setError(problem.response?.data?.error || 'Unable to load current data.');
      } finally { running = false; if (active) setLoading(false); }
    };
    load();
    const timer = interval ? window.setInterval(load, interval) : undefined;
    return () => { active = false; controller.abort(); window.clearInterval(timer); };
  }, [path, interval, revision]);
  return { data, error, loading, refresh };
}

export const duration = (ms: number | null | undefined) => {
  if (ms == null || !Number.isFinite(ms)) return 'Not measured';
  if (ms < 1000) return '<1s';
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? seconds + 's' : Math.floor(seconds / 60) + 'm ' + seconds % 60 + 's';
};

export type Plan = { key: string; name: string; conversionLimit: number | null; used: number; remaining: number | null; canConvert: boolean; priceCents: number; billing: string };
export type AccountSummary = { plan: Plan; stats: { totalSites: number; totalConversions: number; activeJobs: number; completedJobs: number; failedJobs: number; averageDurationMs: number | null; timedConversions: number } };
