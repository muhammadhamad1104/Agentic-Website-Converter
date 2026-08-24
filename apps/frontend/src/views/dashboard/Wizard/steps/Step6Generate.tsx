import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, Loader2, Terminal, Database, Server, Clock, CheckCircle } from 'lucide-react';
import { useJobStore } from '../../../../store/jobStore';
import toast from 'react-hot-toast';

export default function Step6Generate({ onNext, jobId }: { onNext: () => void, jobId?: string | null }) {
  const [progress, setProgress] = useState(15);
  const [status, setStatus] = useState<'running' | 'complete' | 'failed'>('running');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [logs, setLogs] = useState<Array<{ timestamp: string; level: 'info' | 'success' | 'warn' | 'node'; text: string }>>([
    { timestamp: new Date().toLocaleTimeString(), level: 'info', text: 'Initializing LangGraph Code Generation Workflow...' }
  ]);
  const [telemetry, setTelemetry] = useState({
    models: 0,
    apiRoutes: 0,
    components: 0,
    activeNode: 'generate_backend',
  });
  const { getJob } = useJobStore();
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

  // Live polling of generator telemetry and trace events
  useEffect(() => {
    let isMounted = true;
    let intervalRef: ReturnType<typeof setInterval> | null = null;

    if (!jobId) {
      setLogs(prev => [
        ...prev,
        { timestamp: new Date().toLocaleTimeString(), level: 'warn', text: 'No active job ID found.' }
      ]);
      setStatus('failed');
      return;
    }

    const globalSeenTexts = new Set<string>();
    let lastSeenStatus = '';
    let genFinished = false;
    const GEN_NODES = new Set(['generate_backend', 'generate_frontend', 'generate_admin', 'validate_consistency', 'validate_build_smoke', 'validation_review_gate', 'end_package_approved']);

    const poll = async () => {
      if (genFinished || !isMounted) return;

      try {
        const job = await getJob(jobId);
        if (!isMounted) return;

        const currentStatus = ((job as any).status || '').toUpperCase();
        const workerJob = (job as any).workerJob || {};
        const workerStatus = (workerJob?.status || '').toLowerCase();
        const realArtifacts = workerJob?.generated_artifacts || (job as any).generated_artifacts || (job as any).conversionPlan || null;
        const traces: any[] = workerJob?.trace_events || (job as any).trace_events || [];

        // Count telemetry
        const schema = workerJob?.schema_proposal || (job as any).schema_proposal || {};
        let models = (schema.entities || schema.models || []).length || 0;
        let apiRoutes = 0;
        let components = 0;

        if (realArtifacts?.prisma_schema && models === 0) {
          models = (realArtifacts.prisma_schema.match(/model\s+\w+/g) || []).length;
        }
        if (realArtifacts?.backend) {
          // rough estimate based on routes
          apiRoutes = models * 5; 
        }
        if (realArtifacts?.frontend) {
          components = Object.keys(realArtifacts.frontend).length || models * 3;
        }

        const genTraces = traces.filter((t: any) => GEN_NODES.has(t.node));

        setTelemetry({
          models,
          apiRoutes,
          components,
          activeNode: genTraces.length > 0 ? genTraces[genTraces.length - 1].node : 'generate_backend',
        });

        const logEntries: Array<{ timestamp: string; level: 'info' | 'success' | 'warn' | 'node'; text: string }> = [];

        if (currentStatus !== lastSeenStatus) {
          lastSeenStatus = currentStatus;
          if (currentStatus === 'PROCESSING') {
            logEntries.push({
              timestamp: new Date().toLocaleTimeString(),
              level: 'info',
              text: `[Agent:Worker] Synthesizing full-stack application...`
            });
          }
        }

        genTraces.forEach((t: any) => {
          logEntries.push({
            timestamp: new Date().toLocaleTimeString(),
            level: 'node',
            text: `[LangGraph:${t.node}] Synthesis step -> '${t.output_status || 'done'}' (${t.duration_ms ? `${Math.round(t.duration_ms)}ms` : 'ok'})`
          });
        });

        // Dedup logs
        if (logEntries.length > 0) {
          const freshEntries = logEntries.filter(l => !globalSeenTexts.has(l.text));
          if (freshEntries.length > 0) {
            freshEntries.forEach(l => globalSeenTexts.add(l.text));
            setLogs(prev => [...prev, ...freshEntries]);
          }
        }

        // Completion logic
        const lastTrace = genTraces.length > 0 ? genTraces[genTraces.length - 1] : null;
        const traceFinished = lastTrace && lastTrace.node === 'validation_review_gate' && lastTrace.output_status === 'package_approved';
        const isFinished = ['VALIDATED', 'COMPLETED', 'READY'].includes(currentStatus) || 
                           ['validated', 'completed', 'ready', 'generated', 'success', 'package_approved'].includes(workerStatus) || traceFinished;

        if (isFinished) {
          genFinished = true;
          setProgress(100);
          setStatus('complete');
          setLogs(prev => {
            const lastText = `[MCP:Complete] Full-stack codebase generated successfully!`;
            if (prev.some(l => l.text === lastText)) return prev;
            return [...prev, { timestamp: new Date().toLocaleTimeString(), level: 'success', text: lastText }];
          });
          if (intervalRef) clearInterval(intervalRef);
        } else if (currentStatus === 'FAILED' || workerStatus === 'failed') {
          genFinished = true;
          setStatus('failed');
          setLogs(prev => {
            const failText = `[Agent:Error] Code generation failed. Check worker logs.`;
            if (prev.some(l => l.text === failText)) return prev;
            return [...prev, { timestamp: new Date().toLocaleTimeString(), level: 'warn', text: failText }];
          });
          if (intervalRef) clearInterval(intervalRef);
        } else {
          // Dynamic progress
          let p = 20;
          if (workerJob.generated_artifacts?.backend) p = 40;
          if (workerJob.generated_artifacts?.frontend) p = 70;
          if (workerJob.generated_artifacts?.admin) p = 85;
          if (genTraces.some(t => t.node === 'validate_build_smoke')) p = 95;
          setProgress(p);
        }
      } catch (err) {
        // network errors ignored
      }
    };

    poll();
    intervalRef = setInterval(poll, 2000);

    return () => {
      isMounted = false;
      if (intervalRef) clearInterval(intervalRef);
    };
  }, [jobId, getJob]);

  const formatElapsedTime = (secs: number) => {
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    const remainder = secs % 60;
    return `${mins}m ${remainder}s`;
  };

  return (
    <>
      <div className="step-header" style={{ marginBottom: '1rem' }}>
        <h2 className="step-title">Agentic Code Generation</h2>
        <p className="step-subtitle">Real-time code synthesis, automated consistency validation, and AST compilation.</p>
      </div>

      <div className="step-content" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', width: '100%' }}>
        <div style={{ maxWidth: '640px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.25rem', width: '100%' }}>

          {/* 4 Telemetry Metrics Cards Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px' }}>
            <div style={{
              background: 'rgba(15, 23, 42, 0.7)', border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '12px', padding: '0.875rem 1rem', display: 'flex', flexDirection: 'column', gap: '4px'
            }}>
              <span style={{ fontSize: '11px', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Database size={13} style={{ color: '#818cf8' }} /> Models Generated
              </span>
              <span style={{ fontSize: '20px', fontWeight: 800, color: '#818cf8', fontFamily: 'monospace' }}>
                {telemetry.models}
              </span>
            </div>
            <div style={{
              background: 'rgba(15, 23, 42, 0.7)', border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '12px', padding: '0.875rem 1rem', display: 'flex', flexDirection: 'column', gap: '4px'
            }}>
              <span style={{ fontSize: '11px', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Server size={13} style={{ color: '#38bdf8' }} /> API Routes Created
              </span>
              <span style={{ fontSize: '20px', fontWeight: 800, color: '#38bdf8', fontFamily: 'monospace' }}>
                {telemetry.apiRoutes}
              </span>
            </div>
            <div style={{
              background: 'rgba(15, 23, 42, 0.7)', border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '12px', padding: '0.875rem 1rem', display: 'flex', flexDirection: 'column', gap: '4px'
            }}>
              <span style={{ fontSize: '11px', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Clock size={13} style={{ color: '#a855f7' }} /> Time Elapsed
              </span>
              <span style={{ fontSize: '20px', fontWeight: 800, color: '#c084fc', fontFamily: 'monospace' }}>
                {formatElapsedTime(elapsedSeconds)}
              </span>
            </div>
            <div style={{
              background: 'rgba(15, 23, 42, 0.7)', border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '12px', padding: '0.875rem 1rem', display: 'flex', flexDirection: 'column', gap: '4px'
            }}>
              <span style={{ fontSize: '11px', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <CheckCircle size={13} style={{ color: status === 'complete' ? '#34d399' : '#fbbf24' }} /> Status
              </span>
              <span style={{
                fontSize: '11px', fontWeight: 700, fontFamily: 'monospace',
                color: status === 'complete' ? '#34d399' : '#fbbf24', marginTop: '4px'
              }}>
                {status === 'complete' ? 'COMPLETE 100%' : 'SYNTHESIZING...'}
              </span>
            </div>
          </div>

          {/* Dynamic Progress Bar Container */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontFamily: 'monospace', color: '#94a3b8' }}>
              <span>Generation Progress</span>
              <span style={{ color: '#818cf8', fontWeight: 700 }}>{Math.round(progress)}% Complete</span>
            </div>
            <div style={{ width: '100%', height: '8px', borderRadius: '9999px', background: '#1e293b', overflow: 'hidden' }}>
              <div style={{
                width: `${progress}%`, height: '100%', borderRadius: '9999px',
                background: 'linear-gradient(90deg, #4f46e5 0%, #818cf8 100%)',
                transition: 'width 0.4s ease', boxShadow: '0 0 12px rgba(99, 102, 241, 0.6)'
              }} />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {/* Terminal Execution Trace Console */}
            <div style={{
              background: '#090d16', border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '14px', overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
              display: 'flex', flexDirection: 'column'
            }}>
              <div style={{
                background: 'rgba(15, 23, 42, 0.9)', padding: '0.625rem 1rem', borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                fontSize: '12px', color: '#94a3b8', fontFamily: 'monospace'
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
                  padding: '1rem', fontFamily: 'monospace', fontSize: '12px',
                  maxHeight: '280px', minHeight: '280px', overflowY: 'auto',
                  display: 'flex', flexDirection: 'column', gap: '6px', background: '#090d16'
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
            <span>{status === 'complete' ? 'Codebase generated successfully!' : 'Agent synthesizing full-stack application...'}</span>
          </div>
        </div>
        <button
          type="button"
          className={`btn btn-primary transition-all duration-200 ${status === 'complete' ? 'shadow-lg shadow-indigo-500/20' : 'cursor-prohibited-red'}`}
          onClick={async (e) => {
            if (status !== 'complete') {
              e.preventDefault();
              toast.error("Full-stack code generation is in progress. Please wait for 100% completion.");
            } else {
              onNext();
            }
          }}
        >
          {status === 'complete' ? (
            <>Proceed to Download <ArrowRight size={16} /></>
          ) : (
            <><Loader2 size={16} className="animate-spin mr-1" /> Generating Code...</>
          )}
        </button>
      </div>
    </>
  );
}
