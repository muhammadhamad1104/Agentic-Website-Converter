import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, Loader2, Layers, ImageIcon, Clock, CheckCircle, Terminal } from 'lucide-react';
import { useJobStore } from '../../../../store/jobStore';
import toast from 'react-hot-toast';

export default function Step3Crawl({ onNext, jobId }: { onNext: () => void, jobId?: string | null }) {
  const [progress, setProgress] = useState(15);
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
        const crawlDepthLimit = workerJob?.crawl_config?.depth_limit || (job as any).maxDepth || 2;
        const targetMaxPages = crawlDepthLimit >= 3 ? 100 : (crawlDepthLimit === 2 ? 50 : 20);

        // ── Only crawl-related trace events ──────────────────────────
        const crawlTraces = traces.filter((t: any) => CRAWL_NODES.has(t.node));

        setTelemetry({
          pagesCrawled: totalCrawled,
          assetsDiscovered: totalAssets,
          activeNode: crawlTraces.length > 0 ? crawlTraces[crawlTraces.length - 1].node : 'crawl_site',
          targetUrl: targetUrl,
          durationMs: crawlTraces.reduce((acc: number, t: any) => acc + (t.duration_ms || 0), 0),
        });

        // Dynamic progress based on pages crawled
        const dynamicProgress = totalCrawled > 0
          ? Math.min(95, Math.max(20, Math.round((totalCrawled / targetMaxPages) * 100)))
          : (crawlStatus === 'PROCESSING' ? 18 : 15);

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
          const sizeKb = Math.round((p.content_length || 4000) / 1024);
          logEntries.push({
            timestamp: new Date().toLocaleTimeString(),
            level: 'info',
            text: `[MCP:Crawler #${idx + 1}] GET ${urlStr} ── 200 OK (${sizeKb} KB)`
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
        const crawlRecordDone = ['COMPLETED', 'READY'].includes(crawlStatus);
        const postCrawlNodesStarted = traces.some((t: any) =>
          !CRAWL_NODES.has(t.node) && t.node !== 'quality.extract_content'
        );
        const workerDone = ['validated', 'completed', 'ready', 'awaiting_approval', 'schema_approved'].includes(workerStatus);
        const isDone = crawlRecordDone || postCrawlNodesStarted || workerDone;

        if (isDone) {
          crawlFinished = true;
          setProgress(100);
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
        } else if (crawlStatus === 'FAILED') {
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
          setProgress(dynamicProgress);
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

  return (
    <>
      <div className="step-header" style={{ marginBottom: '1rem' }}>
        <h2 className="step-title">Agentic Crawl & Discovery</h2>
        <p className="step-subtitle">Real-time MCP page crawling, asset discovery, and relational structure analysis.</p>
      </div>

      <div className="step-content" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ maxWidth: '640px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.25rem', width: '100%' }}>

          {/* 4 Telemetry Metrics Cards Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px' }}>

            {/* Pages Crawled */}
            <div style={{
              background: 'rgba(15, 23, 42, 0.7)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '12px',
              padding: '0.875rem 1rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px'
            }}>
              <span style={{ fontSize: '11px', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Layers size={13} style={{ color: '#818cf8' }} /> Pages Crawled
              </span>
              <span style={{ fontSize: '20px', fontWeight: 800, color: '#818cf8', fontFamily: 'monospace' }}>
                {telemetry.pagesCrawled}
              </span>
            </div>

            {/* Assets Discovered */}
            <div style={{
              background: 'rgba(15, 23, 42, 0.7)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '12px',
              padding: '0.875rem 1rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px'
            }}>
              <span style={{ fontSize: '11px', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <ImageIcon size={13} style={{ color: '#38bdf8' }} /> Assets Discovered
              </span>
              <span style={{ fontSize: '20px', fontWeight: 800, color: '#38bdf8', fontFamily: 'monospace' }}>
                {telemetry.assetsDiscovered}
              </span>
            </div>

            {/* Real-time Dynamic Timer */}
            <div style={{
              background: 'rgba(15, 23, 42, 0.7)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '12px',
              padding: '0.875rem 1rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px'
            }}>
              <span style={{ fontSize: '11px', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Clock size={13} style={{ color: '#a855f7' }} /> Time Elapsed
              </span>
              <span style={{ fontSize: '20px', fontWeight: 800, color: '#c084fc', fontFamily: 'monospace' }}>
                {formatElapsedTime(elapsedSeconds)}
              </span>
            </div>

            {/* Status */}
            <div style={{
              background: 'rgba(15, 23, 42, 0.7)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '12px',
              padding: '0.875rem 1rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px'
            }}>
              <span style={{ fontSize: '11px', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <CheckCircle size={13} style={{ color: status === 'complete' ? '#34d399' : '#fbbf24' }} /> Status
              </span>
              <span style={{
                fontSize: '11px',
                fontWeight: 700,
                fontFamily: 'monospace',
                color: status === 'complete' ? '#34d399' : '#fbbf24',
                marginTop: '4px'
              }}>
                {status === 'complete' ? 'COMPLETE 100%' : 'CRAWLING...'}
              </span>
            </div>

          </div>

          {/* Dynamic Progress Bar Container */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontFamily: 'monospace', color: '#94a3b8' }}>
              <span>Crawl Progress</span>
              <span style={{ color: '#818cf8', fontWeight: 700 }}>{Math.round(progress)}% Complete</span>
            </div>
            <div style={{
              width: '100%',
              height: '8px',
              borderRadius: '9999px',
              background: '#1e293b',
              overflow: 'hidden'
            }}>
              <div style={{
                width: `${progress}%`,
                height: '100%',
                borderRadius: '9999px',
                background: 'linear-gradient(90deg, #4f46e5 0%, #818cf8 100%)',
                transition: 'width 0.4s ease',
                boxShadow: '0 0 12px rgba(99, 102, 241, 0.6)'
              }} />
            </div>
          </div>

          {/* Terminal Execution Trace Console */}
          <div style={{
            background: '#090d16',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '14px',
            overflow: 'hidden',
            boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
            display: 'flex',
            flexDirection: 'column'
          }}>
            <div style={{
              background: 'rgba(15, 23, 42, 0.9)',
              padding: '0.625rem 1rem',
              borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '12px',
              color: '#94a3b8',
              fontFamily: 'monospace'
            }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Terminal size={14} style={{ color: '#818cf8' }} />
                MCP & LangGraph Agent Trace Console
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#34d399' }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '9999px', background: '#34d399' }} />
                Live Output Stream
              </span>
            </div>

            <div
              ref={consoleRef}
              style={{
                padding: '1rem',
                fontFamily: 'monospace',
                fontSize: '12px',
                maxHeight: '280px',
                minHeight: '280px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                background: '#090d16'
              }}
            >
              <AnimatePresence>
                {logs.map((log, idx) => {
                  const isWarn = log.level === 'warn';
                  const isSuccess = log.level === 'success';
                  const isNode = log.level === 'node';

                  return (
                    <motion.div
                      key={idx + log.text}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', lineHeight: 1.5 }}
                    >
                      <span style={{ color: '#64748b', flexShrink: 0, fontSize: '10px', paddingTop: '2px' }}>{log.timestamp}</span>
                      <span style={{
                        color: isWarn ? '#fbbf24' : isSuccess ? '#34d399' : isNode ? '#a5b4fc' : '#e2e8f0',
                        fontWeight: isSuccess || isWarn ? 700 : 400
                      }}>
                        {log.text}
                      </span>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          </div>

        </div>
      </div>

      <div className="step-actions" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '1rem', borderTop: '1px solid rgba(255, 255, 255, 0.1)', marginTop: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#94a3b8', fontFamily: 'monospace' }}>
            {status !== 'complete' && <Loader2 size={14} className="animate-spin" style={{ color: '#fbbf24' }} />}
            <span>{status === 'complete' ? 'Crawl 100% complete!' : 'Agent crawling target pages...'}</span>
          </div>
        </div>
        <button
          type="button"
          className={`btn btn-primary transition-all duration-200 ${status === 'complete' ? 'shadow-lg shadow-indigo-500/20' : 'cursor-prohibited-red'
            }`}
          onClick={async (e) => {
            if (status !== 'complete') {
              e.preventDefault();
              toast.error("Page crawling is currently in progress. Please wait for 100% completion.");
            } else {
              if (jobId) {
                await inferSchema(jobId).catch(() => { });
              }
              onNext();
            }
          }}
        >
          {status === 'complete' ? (
            <>Proceed to Schema Analysis <ArrowRight size={16} /></>
          ) : (
            <><Loader2 size={16} className="animate-spin mr-1" /> Crawling In Progress...</>
          )}
        </button>
      </div>
    </>
  );
}
