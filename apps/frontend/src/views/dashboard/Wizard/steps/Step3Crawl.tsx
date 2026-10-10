import { useState, useEffect, useRef } from 'react';
import ProgressPanel from './ProgressPanel';
import { ArrowRight } from 'lucide-react';
import { useJobStore } from '../../../../store/jobStore';
import toast from 'react-hot-toast';

export default function Step3Crawl({ onNext, jobId }: { onNext: () => void, jobId?: string | null }) {
  const [advancing, setAdvancing] = useState(false);
  const [status, setStatus] = useState<'running' | 'complete' | 'failed'>('running');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [logs, setLogs] = useState<Array<{ timestamp: string; level: 'info' | 'success' | 'warn' | 'node'; text: string }>>([
    { timestamp: new Date().toLocaleTimeString(), level: 'info', text: 'Initializing LangGraph Conversion Workflow & MCP Crawler Engine...' }
  ]);
  const [telemetry, setTelemetry] = useState({
    pagesCrawled: 0,
    assetsDiscovered: 0,
    activeNode: 'crawl_site',
    targetUrl: '',
    durationMs: 0,
  });

  const { getJob, inferSchema } = useJobStore();
  const consoleRef = useRef<HTMLDivElement>(null);
  const startTimeRef = useRef<number>(Date.now());

  // Real-time stopwatch timer
  useEffect(() => {
    if (status !== 'running') return;

    const timer = setInterval(() => {
      const seconds = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setElapsedSeconds(seconds);
    }, 1000);

    return () => clearInterval(timer);
  }, [status]);

  // Auto scroll terminal log console
  useEffect(() => {
    if (consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [logs]);

  // Live polling of crawler telemetry and trace events
  useEffect(() => {
    let isMounted = true;
    let intervalRef: ReturnType<typeof setInterval> | null = null;

    if (!jobId) {
      setLogs(prev => [
        ...prev,
        { timestamp: new Date().toLocaleTimeString(), level: 'warn', text: 'No active job ID found. Please verify site input.' }
      ]);
      setStatus('failed');
      return;
    }

    // Persistent set across polls — prevents old log text from being re-added
    const globalSeenTexts = new Set<string>();
    // Track status transitions (only emit transition logs once)
    let lastSeenStatus = '';
    // Once crawl is done, freeze the terminal
    let crawlFinished = false;

    // Only these LangGraph nodes are crawl-related
    const CRAWL_NODES = new Set(['crawl_site', 'sitemap_gate']);

    const poll = async () => {
      if (crawlFinished || !isMounted) return;

      try {
        const job = await getJob(jobId);
        if (!isMounted) return;

        // ── Read from Prisma Crawl record (always available) ──────────
        const crawlStatus = ((job as any).status || '').toUpperCase();
        const crawlStartUrl = (job as any).startUrl || '';
        const crawlPagesCrawled = (job as any).pagesCrawled || 0;
        const crawlAssetsDiscovered = (job as any).assetsDiscovered || 0;

        // ── Read from Python Worker (may be null if logRef not set yet) ──
        const workerJob = (job as any).workerJob || null;
        const workerStatus = (workerJob?.status || '').toLowerCase();
        const crawlArtifacts = workerJob?.crawl_artifacts || {};
        const workerPages: any[] = crawlArtifacts.pages || [];
        const traces: any[] = workerJob?.trace_events || [];

        // ── Merge data: prefer worker details, fallback to crawl record ──
        const targetUrl = crawlStartUrl || crawlArtifacts.root_url || (job as any).inputUrl || '';
        const totalCrawled = Math.max(crawlPagesCrawled, workerPages.length);
        const totalAssets = Math.max(crawlAssetsDiscovered, (crawlArtifacts.assets || []).length);

        // ── Only crawl-related trace events ──────────────────────────
        const crawlTraces = traces.filter((t: any) => CRAWL_NODES.has(t.node));

        setTelemetry({
          pagesCrawled: totalCrawled,
          assetsDiscovered: totalAssets,
          activeNode: crawlTraces.length > 0 ? crawlTraces[crawlTraces.length - 1].node : 'crawl_site',
          targetUrl: targetUrl,
          durationMs: crawlTraces.reduce((acc: number, t: any) => acc + (t.duration_ms || 0), 0),
        });

        // ── Build live terminal log entries (only crawl-related) ─────
        const logEntries: Array<{ timestamp: string; level: 'info' | 'success' | 'warn' | 'node'; text: string }> = [];

        // Status transition logs (emitted once per status change)
        if (crawlStatus !== lastSeenStatus) {
          lastSeenStatus = crawlStatus;

          if (crawlStatus === 'PENDING') {
            logEntries.push({
              timestamp: new Date().toLocaleTimeString(),
              level: 'info',
              text: `[Agent:Queue] Job queued. Waiting for worker allocation...`
            });
          } else if (crawlStatus === 'PROCESSING') {
            logEntries.push({
              timestamp: new Date().toLocaleTimeString(),
              level: 'info',
              text: `[Agent:Worker] Worker assigned. Crawl engine starting...`
            });
          }
        }

        // Target URL log
        if (targetUrl) {
          logEntries.push({
            timestamp: new Date().toLocaleTimeString(),
            level: 'info',
            text: `[MCP:Target] Base URL set to ${targetUrl}`
          });
        }

        // Worker not yet connected indicator
        if (!workerJob && (crawlStatus === 'PROCESSING')) {
          logEntries.push({
            timestamp: new Date().toLocaleTimeString(),
            level: 'info',
            text: `[Agent:Bridge] Python worker initializing crawl pipeline...`
          });
        }

        // Live crawl progress from crawl record (even without worker data)
        if (totalCrawled > 0 && workerPages.length === 0) {
          logEntries.push({
            timestamp: new Date().toLocaleTimeString(),
            level: 'info',
            text: `[MCP:Crawler] ${totalCrawled} page(s) crawled, ${totalAssets} asset(s) discovered so far...`
          });
        }

        // Detailed page logs from worker data (crawl pages only)
        workerPages.forEach((p: any, idx: number) => {
          const urlStr = p.url || p;
          const size = typeof p.content_length === 'number' ? ' / ' + Math.round(p.content_length / 1024) + ' KB' : '';
          logEntries.push({
            timestamp: new Date().toLocaleTimeString(),
            level: 'info',
            text: `[MCP:Crawler #${idx + 1}] GET ${urlStr}${size}`
          });
        });

        // Only crawl-related LangGraph trace events (crawl_site, sitemap_gate)
        crawlTraces.forEach((t: any) => {
          logEntries.push({
            timestamp: new Date().toLocaleTimeString(),
            level: 'node',
            text: `[LangGraph:${t.node}] Crawl step -> '${t.output_status || 'done'}' (${t.duration_ms ? `${Math.round(t.duration_ms)}ms` : 'ok'})`
          });
        });

        // ── Stable dedup: use persistent globalSeenTexts set ─────────
        if (logEntries.length > 0) {
          const freshEntries = logEntries.filter(l => !globalSeenTexts.has(l.text));
          if (freshEntries.length > 0) {
            freshEntries.forEach(l => globalSeenTexts.add(l.text));
            setLogs(prev => [...prev, ...freshEntries]);
          }
        }

        // ── Completion detection (crawl-specific) ────────────────────
        // Crawl is done when:
        //  - DB record says COMPLETED/READY, OR
        //  - Worker trace shows post-crawl nodes started (extract_content, etc.), OR
        //  - Worker status indicates full completion
        const crawlRecordDone = ['CRAWLED', 'COMPLETED', 'READY'].includes(crawlStatus);
        const workerDone = ['crawled', 'validated', 'completed', 'ready', 'awaiting_approval', 'schema_approved'].includes(workerStatus);
        const failed = crawlStatus === 'FAILED' || ['failed', 'cancelled'].includes(workerStatus);
        const isDone = !failed && (crawlRecordDone || workerDone);

        if (isDone) {
          crawlFinished = true;
          setStatus('complete');
          setLogs(prev => {
            const lastText = `[MCP:Complete] All pages crawled successfully! Ready to proceed.`;
            if (prev.some(l => l.text === lastText)) return prev;
            return [...prev, { timestamp: new Date().toLocaleTimeString(), level: 'success', text: lastText }];
          });
          // Stop polling — crawl step is done, terminal is frozen
          if (intervalRef) {
            clearInterval(intervalRef);
            intervalRef = null;
          }
        } else if (failed) {
          crawlFinished = true;
          setStatus('failed');
          setLogs(prev => {
            const failText = `[Agent:Error] Crawl job failed. Check worker logs for details.`;
            if (prev.some(l => l.text === failText)) return prev;
            return [...prev, { timestamp: new Date().toLocaleTimeString(), level: 'warn', text: failText }];
          });
          if (intervalRef) {
            clearInterval(intervalRef);
            intervalRef = null;
          }
        } else {
        }
      } catch (err) {
        // Silently handle polling errors — network blips are expected
      }
    };

    poll();
    intervalRef = setInterval(poll, 1500);

    return () => {
      isMounted = false;
      if (intervalRef) clearInterval(intervalRef);
    };
  }, [jobId, getJob]);

  // Format real-time elapsed seconds
  const formatElapsedTime = (secs: number) => {
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    const remainder = secs % 60;
    return `${mins}m ${remainder}s`;
  };

  return <>
    <ProgressPanel status={status} elapsed={formatElapsedTime(elapsedSeconds)} logs={logs} metrics={[{ label: 'Captured pages', value: telemetry.pagesCrawled }, { label: 'Captured assets', value: telemetry.assetsDiscovered }, { label: 'Worker stage', value: telemetry.activeNode }]} />
    <div className="step-actions"><button className="btn btn-primary" disabled={status !== 'complete' || advancing} onClick={async () => {
 if (!jobId) return; setAdvancing(true); try { await inferSchema(jobId); onNext(); } catch { toast.error('Unable to start schema inference. Please try again.'); } finally { setAdvancing(false); }
}}>{advancing ? 'Starting analysis...' : 'Proceed to Schema Analysis'}<ArrowRight size={16} /></button></div></>;
}
