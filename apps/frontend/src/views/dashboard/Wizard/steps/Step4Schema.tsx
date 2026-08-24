import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, Loader2, Database, Clock, Layers, CheckCircle, Terminal } from 'lucide-react';
import { useJobStore } from '../../../../store/jobStore';
import toast from 'react-hot-toast';

export default function Step4Schema({ onNext, jobId }: { onNext: () => void, jobId?: string | null }) {
  const [progress, setProgress] = useState(20);
  const [status, setStatus] = useState<'running' | 'complete' | 'failed'>('running');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [entities, setEntities] = useState<any[]>([]);
  const [logs, setLogs] = useState<Array<{ timestamp: string; level: 'info' | 'success' | 'warn' | 'node'; text: string }>>([
    { timestamp: new Date().toLocaleTimeString(), level: 'info', text: 'Initializing LangGraph Conversion Workflow & Schema Inference Engine...' }
  ]);

  const { getJob, inferSchema } = useJobStore();
  const consoleRef = useRef<HTMLDivElement>(null);
  const startTimeRef = useRef<number>(Date.now());
  const hasTriggeredInference = useRef(false);

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

  // Live polling of schema inference telemetry and trace events
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

    const globalSeenTexts = new Set<string>();
    let schemaFinished = false;

    const SCHEMA_NODES = new Set(['extract_content', 'infer_candidates', 'infer_schema', 'schema_review_gate', 'engine.infer_schema_stage']);

    const poll = async () => {
      if (schemaFinished || !isMounted) return;

      try {
        const job = await getJob(jobId);
        if (!isMounted) return;

        const crawlStatus = ((job as any).status || '').toUpperCase();
        const workerJob = (job as any).workerJob || null;
        const workerStatus = (workerJob?.status || '').toLowerCase();
        const schema = workerJob?.schema_proposal || {};
        const foundEntities: any[] = schema.entities || schema.models || [];
        const traces: any[] = workerJob?.trace_events || [];
        const workerErrors: string[] = workerJob?.errors || [];

        // 1. When real entities exist from Python worker
        if (foundEntities.length > 0) {
          setEntities(foundEntities);
          setStatus('complete');
          setProgress(100);
          schemaFinished = true;

          const finishMsg = `[MCP:Complete] AI Schema Inference completed! ${foundEntities.length} model(s) ready for review.`;
          if (!globalSeenTexts.has(finishMsg)) {
            globalSeenTexts.add(finishMsg);
            setLogs(prev => [...prev, { timestamp: new Date().toLocaleTimeString(), level: 'success', text: finishMsg }]);
          }
          if (intervalRef) {
            clearInterval(intervalRef);
            intervalRef = null;
          }
          return;
        }

        // 2. Trigger schema inference if entering from crawl complete states or already INFERRING_SCHEMA
        if (!hasTriggeredInference.current && ['CRAWLED', 'COMPLETED', 'READY', 'INFERRING_SCHEMA'].includes(crawlStatus)) {
          hasTriggeredInference.current = true;
          setLogs(prev => [
            ...prev,
            { timestamp: new Date().toLocaleTimeString(), level: 'info', text: '[Agent:LLM] Executing schema inference pipeline on crawled pages...' }
          ]);
          // Only call inferSchema if the worker hasn't started yet (status is still crawled)
          if (workerStatus !== 'inferring_schema') {
            await inferSchema(jobId).catch(() => { });
          }
        }

        // 3. Process trace logs (including error messages from trace events)
        const schemaTraces = traces.filter((t: any) => SCHEMA_NODES.has(t.node));
        const logEntries: Array<{ timestamp: string; level: 'info' | 'success' | 'warn' | 'node'; text: string }> = [];

        schemaTraces.forEach((t: any) => {
          const traceText = t.message
            ? `[LangGraph:${t.node}] ${t.message}`
            : `[LangGraph:${t.node}] Step status -> '${t.output_status || 'done'}' (${t.duration_ms ? `${Math.round(t.duration_ms)}ms` : 'ok'})`;
          logEntries.push({
            timestamp: new Date().toLocaleTimeString(),
            level: t.output_status === 'failed' ? 'warn' : 'node',
            text: traceText,
          });
        });

        if (logEntries.length > 0) {
          const freshEntries = logEntries.filter(l => !globalSeenTexts.has(l.text));
          if (freshEntries.length > 0) {
            freshEntries.forEach(l => globalSeenTexts.add(l.text));
            setLogs(prev => [...prev, ...freshEntries]);
          }
        }

        // 4. Update status and progress — detect failures from both crawl status and worker status
        if (workerStatus === 'failed' || crawlStatus === 'FAILED') {
          schemaFinished = true;
          setStatus('failed');
          const errorDetail = workerErrors.length > 0 ? workerErrors[workerErrors.length - 1] : 'Check worker service logs.';
          const failMsg = `[Agent:Error] Schema inference failed: ${errorDetail}`;
          if (!globalSeenTexts.has(failMsg)) {
            globalSeenTexts.add(failMsg);
            setLogs(prev => [...prev, { timestamp: new Date().toLocaleTimeString(), level: 'warn', text: failMsg }]);
          }
          if (intervalRef) {
            clearInterval(intervalRef);
            intervalRef = null;
          }
        } else {
          // Increment progress gradually
          setProgress(p => Math.min(95, p + 5));
        }
      } catch (err) {
        // Network polling error fallback — don't crash the poll loop
      }
    };

    poll();
    intervalRef = setInterval(poll, 2000);

    return () => {
      isMounted = false;
      if (intervalRef) clearInterval(intervalRef);
    };
  }, [jobId, getJob, inferSchema]);

  const totalFields = entities.reduce((acc, e) => {
    const fieldsList = e.fields || e.properties || [];
    return acc + (Array.isArray(fieldsList) ? fieldsList.length : 0);
  }, 0);

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
        <h2 className="step-title">Agentic Relational Schema Inference</h2>
        <p className="step-subtitle">Real-time database model deduction, field mapping, and entity relation extraction.</p>
      </div>

      <div className="step-content" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ maxWidth: '640px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.25rem', width: '100%' }}>

          {/* 4 Telemetry Metrics Cards Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px' }}>

            {/* Entity Models */}
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
                <Database size={13} style={{ color: '#818cf8' }} /> Entity Models
              </span>
              <span style={{ fontSize: '20px', fontWeight: 800, color: '#818cf8', fontFamily: 'monospace' }}>
                {entities.length}
              </span>
            </div>

            {/* Fields Mapped */}
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
                <Layers size={13} style={{ color: '#38bdf8' }} /> Fields Mapped
              </span>
              <span style={{ fontSize: '20px', fontWeight: 800, color: '#38bdf8', fontFamily: 'monospace' }}>
                {totalFields}
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
                {status === 'complete' ? 'COMPLETE 100%' : 'INFERRING...'}
              </span>
            </div>

          </div>

          {/* Dynamic Progress Bar Container */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontFamily: 'monospace', color: '#94a3b8' }}>
              <span>Schema Inference Progress</span>
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

          {/* Trace Console Container */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
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
      </div>

      <div className="step-actions" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '1rem' }}>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#94a3b8', fontFamily: 'monospace' }}>
            {status !== 'complete' && <Loader2 size={14} className="animate-spin" style={{ color: '#fbbf24' }} />}
            <span>{status === 'complete' ? 'Schema Inference 100% complete!' : 'Agent inferring database models...'}</span>
          </div>
        </div>
        <button
          type="button"
          className={`btn btn-primary transition-all duration-200 ${status === 'complete' ? 'shadow-lg shadow-indigo-500/20' : 'cursor-prohibited-red'
            }`}
          onClick={(e) => {
            if (status !== 'complete') {
              e.preventDefault();
              toast.error("Schema inference is currently in progress. Please wait for 100% completion.");
            } else {
              onNext();
            }
          }}
        >
          {status === 'complete' ? (
            <>Review & Approve Schema <ArrowRight size={16} /></>
          ) : (
            <><Loader2 size={16} className="animate-spin mr-1" /> Inferring Schema...</>
          )}
        </button>
      </div>
    </>
  );
}
