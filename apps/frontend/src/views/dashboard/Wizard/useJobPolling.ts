import { useEffect, useRef, useState } from 'react';
import { useJobStore } from '../../../store/jobStore';
import type { ConversionJob } from '../../../types/job';

// Schedule the next read only after the previous read and stage handoff settle.
export function useJobPolling(jobId: string | null | undefined, onJob: (job: ConversionJob) => boolean | Promise<boolean>) {
  const { getJob } = useJobStore();
  const callback = useRef(onJob);
  callback.current = onJob;
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    setError('');
    if (!jobId) { setError('No active conversion found.'); return; }
    const poll = async () => {
      let delay = 2000;
      try {
        const job = await getJob(jobId);
        if (!active) return;
        setError(''); failures = 0;
        if (await callback.current(job)) return;
      } catch (problem: any) {
        if (!active) return;
        const terminal = [401, 403, 404].includes(problem.response?.status);
        setError(terminal ? 'Conversion unavailable. Refresh status to try again.' : 'Unable to refresh status. Reconnecting...');
        if (terminal) return;
        delay = Math.min(15000, 2000 * 2 ** ++failures);
      }
      if (active) timer = setTimeout(poll, delay);
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [jobId, getJob, revision]);
  return { error, refresh: () => setRevision(value => value + 1) };
}

export function useStageElapsed(running: boolean) {
  const started = useRef(Date.now());
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started.current) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
