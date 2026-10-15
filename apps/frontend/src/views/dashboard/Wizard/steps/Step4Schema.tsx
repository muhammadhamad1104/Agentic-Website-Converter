import { useState, useEffect, useRef } from 'react';
import ProgressPanel from './ProgressPanel';
import { ArrowRight } from 'lucide-react';
import { useJobStore } from '../../../../store/jobStore';

export default function Step4Schema({ onNext, jobId }: { onNext: () => void, jobId?: string | null }) {
  const [status, setStatus] = useState<'running' | 'complete' | 'failed'>('running');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [entities, setEntities] = useState<any[]>([]);
  const [progress, setProgress] = useState<{ completed_batches?: number; total_batches?: number; entity_count?: number; field_count?: number }>({});
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
    let polling = false;

    const SCHEMA_NODES = new Set(['extract_content', 'infer_candidates', 'infer_schema', 'schema_review_gate', 'engine.infer_schema_stage']);

    const poll = async () => {
      if (schemaFinished || !isMounted || polling) return;
      polling = true;

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
        if (workerJob?.schema_quality_report?.inference_progress)
          setProgress(workerJob.schema_quality_report.inference_progress);

        // 1. When real entities exist from Python worker
        const schemaReady = ['awaiting_approval', 'schema_proposed', 'approved', 'generated', 'validated', 'completed', 'ready'].includes(workerStatus);
        if (foundEntities.length > 0 && schemaReady && workerJob?.schema_decision !== 'rejected') {
          setEntities(foundEntities);
          setStatus('complete');
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

        // Start inference only when the worker is waiting after a completed crawl.
        if (!hasTriggeredInference.current && crawlStatus === 'CRAWLED' && workerStatus === 'crawled') {
          hasTriggeredInference.current = true;
          setLogs(prev => [
            ...prev,
            { timestamp: new Date().toLocaleTimeString(), level: 'info', text: '[Agent:LLM] Executing schema inference pipeline on crawled pages...' }
          ]);
          try { await inferSchema(jobId); }
          catch { hasTriggeredInference.current = false; }
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
        if (['failed', 'cancelled', 'error'].includes(workerStatus) || crawlStatus === 'FAILED') {
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
        }
      } catch (err) {
        // Network polling error fallback — don't crash the poll loop
      } finally {
        polling = false;
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


  return <>
    <ProgressPanel status={status} elapsed={formatElapsedTime(elapsedSeconds)} logs={logs} metrics={[{ label: 'Content models', value: entities.length || progress.entity_count || 0 }, { label: 'Fields', value: totalFields || progress.field_count || 0 }, { label: 'Evidence batches', value: progress.total_batches ? `${progress.completed_batches || 0} / ${progress.total_batches}` : '--' }]} />
    <div className="step-actions"><button className="btn btn-primary" disabled={status !== 'complete'} onClick={onNext}>Review schema <ArrowRight size={16} /></button></div></>;
}
