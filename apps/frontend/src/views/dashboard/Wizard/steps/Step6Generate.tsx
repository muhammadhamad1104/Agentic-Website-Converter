import { useState, useEffect, useRef } from 'react';
import ProgressPanel, { generatedFileCount } from './ProgressPanel';
import { ArrowRight, Loader2 } from 'lucide-react';
import { useJobStore } from '../../../../store/jobStore';

export default function Step6Generate({ onNext, jobId }: { onNext: () => void, jobId?: string | null }) {
  const [status, setStatus] = useState<'running' | 'complete' | 'warnings' | 'failed'>('running');
  const canDownload = status === 'complete' || status === 'warnings';
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
        apiRoutes = generatedFileCount(realArtifacts?.backend);
        components = generatedFileCount(realArtifacts?.frontend);

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
        const isFinished = workerJob.validation_report?.validation_gate === 'open' &&
                           workerJob.validation_report?.build_status === 'passed' &&
                           ['validated', 'completed', 'ready'].includes(workerStatus);

        if (isFinished) {
          genFinished = true;
          setStatus(workerJob.validation_report?.issues?.length ? 'warnings' : 'complete');
          setLogs(prev => {
            const lastText = `[MCP:Complete] Full-stack codebase generated successfully!`;
            if (prev.some(l => l.text === lastText)) return prev;
            return [...prev, { timestamp: new Date().toLocaleTimeString(), level: 'success', text: lastText }];
          });
          if (intervalRef) clearInterval(intervalRef);
        } else if (currentStatus === 'FAILED' || workerStatus === 'failed') {
          genFinished = true;
          const hasFiles = Boolean(realArtifacts?.backend || realArtifacts?.frontend || realArtifacts?.admin);
          setStatus(hasFiles ? 'warnings' : 'failed');
          setLogs(prev => {
            const blockers = (workerJob.validation_report?.issues || [])
              .filter((issue: any) => issue.severity === 'blocker')
              .map((issue: any) => issue.message);
            const details = [...new Set([...blockers, ...(workerJob.errors || [])])].join(' ');
            const failText = `[Agent:Error] ${details || 'Generation failed before validation completed.'}`;
            if (prev.some(l => l.text === failText)) return prev;
            return [...prev, { timestamp: new Date().toLocaleTimeString(), level: 'warn', text: failText }];
          });
          if (intervalRef) clearInterval(intervalRef);
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

  return <>
    <ProgressPanel status={status} elapsed={formatElapsedTime(elapsedSeconds)} logs={logs} metrics={[{ label: 'Content models', value: telemetry.models }, { label: 'Backend files', value: telemetry.apiRoutes }, { label: 'Frontend files', value: telemetry.components }]} />
    <div className="step-actions"><button className="btn btn-primary" disabled={!canDownload} onClick={onNext}>{canDownload ? <>Proceed to Download <ArrowRight size={16} /></> : status === 'running' ? <><Loader2 size={16} className="animate-spin" />Generating Code...</> : 'No files available'}</button></div></>;
}
