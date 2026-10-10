import { useEffect, useRef, useState } from 'react';
import api from '../services/api';

type Preview = { status: 'stopped' | 'starting' | 'ready' | 'failed'; url?: string; error?: string;
  stage?: string; message?: string; progress?: number; startedAt?: number; elapsedSeconds?: number };
type Lease = { path: string; token: string | null; missed: number };

function release(lease: Lease) {
  // Keepalive survives navigation and page close; worker expiry covers offline tabs.
  return fetch(api.defaults.baseURL + lease.path, { method: 'DELETE', keepalive: true,
    headers: { Authorization: 'Bearer ' + lease.token } }).catch(() => undefined);
}

export function usePreview(jobId?: string) {
  const [preview, setPreview] = useState<Preview>({ status: 'stopped' });
  const lease = useRef<Lease | null>(null);
  useEffect(() => {
    setPreview({ status: 'stopped' });
    let heartbeatRunning = false;
    const cleanup = () => {
      const current = lease.current;
      lease.current = null;
      if (current) void release(current);
    };
    const heartbeat = window.setInterval(async () => {
      const current = lease.current;
      if (!current || heartbeatRunning) return;
      heartbeatRunning = true;
      try {
        const result = await api.put(current.path, undefined, { timeout: 10000 });
        current.missed = 0;
        if (lease.current === current) setPreview(previous => ({
          ...result.data, url: result.data.status === 'ready' && previous.status === 'ready' ? previous.url : result.data.url,
        }));
      } catch (error: any) {
        if (lease.current === current) {
          const status = error.response?.status;
          if ((!status || status >= 500) && ++current.missed < 3) return;
          setPreview({ status: 'failed', error: error.response?.data?.error || 'Preview connection lost.' });
          cleanup();
        }
      } finally { heartbeatRunning = false; }
    }, 5000);
    window.addEventListener('pagehide', cleanup);
    return () => { window.clearInterval(heartbeat); window.removeEventListener('pagehide', cleanup); cleanup(); };
  }, [jobId]);
  const stop = async () => {
    const current = lease.current;
    lease.current = null;
    setPreview({ status: 'stopped' });
    if (current) await release(current);
  };
  const start = async () => {
    if (!jobId) return;
    if (lease.current) await stop();
    const current = { path: '/jobs/' + jobId + '/preview/' + crypto.randomUUID(), token: localStorage.getItem('token'), missed: 0 };
    lease.current = current;
    setPreview({ status: 'starting', stage: 'queued', message: 'Preparing an isolated preview', progress: 4,
      startedAt: Date.now(), elapsedSeconds: 0 });
    try {
      const result = await api.post(current.path);
      if (lease.current === current) setPreview(result.data);
    } catch (error: any) {
      if (lease.current === current) {
        lease.current = null;
        void release(current);
        setPreview({ status: 'failed', error: error.response?.data?.error || 'Unable to start preview.' });
      }
    }
  };
  return { ...preview, start, stop };
}
