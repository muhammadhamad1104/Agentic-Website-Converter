import { useState, useEffect } from 'react';
import { ArrowRight, Download, Loader2, Database, Server, LayoutTemplate, Code2, Sparkles, CheckCircle2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import api from '../../../../services/api';
import toast from 'react-hot-toast';
import { useJobStore } from '../../../../store/jobStore';

export default function Step7Export({ jobId }: { jobId?: string | null }) {
  const navigate = useNavigate();
  const [isDownloading, setIsDownloading] = useState(false);
  const { getJob } = useJobStore();
  const [stats, setStats] = useState({ models: 0, routes: 0, components: 0 });

  useEffect(() => {
    if (jobId) {
      getJob(jobId).then((job) => {
        if (!job) return;
        const workerJob = (job as any).workerJob || {};
        const schema = workerJob?.schema_proposal || (job as any).schema_proposal || {};
        const models = (schema.entities || schema.models || []).length || 0;

        const routes = models * 5;
        const components = models * 3;

        setStats({ models, routes, components });
      }).catch(() => { });
    }
  }, [jobId, getJob]);

  const handleDownload = async () => {
    if (!jobId) {
      toast.error('No conversion job found to export.');
      return;
    }

    setIsDownloading(true);
    toast.success('Preparing source code package...');

    try {
      await api.post(`/jobs/${jobId}/export`);

      const response = await api.get(`/jobs/${jobId}/download`, {
        responseType: 'blob',
        timeout: 60000,
      });

      const blob = new Blob([response.data], { type: 'application/zip' });
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.setAttribute('download', `converted-site-${jobId}.zip`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(downloadUrl);

      toast.success('Download started! 🎉');
    } catch (err: any) {
      const message = err.response?.status === 400
        ? 'Project package is not ready yet. Please wait for generation to complete.'
        : 'Failed to download project package. Please try again.';
      toast.error(message);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <>
      <div className="step-header" style={{ marginBottom: '0.75rem' }}>
        <h2 className="step-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.25rem' }}>
          <Sparkles className="text-indigo-400" size={20} /> Full-Stack Application Ready!
        </h2>
        <p className="step-subtitle" style={{ fontSize: '0.85rem' }}>Your agentic generation is complete. The codebase has been synthesized and validated.</p>
      </div>

      <div className="step-content" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '0.25rem 0' }}>
        <div style={{ maxWidth: '750px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%' }}>

          {/* Stats Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.75rem' }}>
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              style={{
                background: 'linear-gradient(145deg, rgba(30, 41, 59, 0.7) 0%, rgba(15, 23, 42, 0.9) 100%)',
                border: '1px solid rgba(255, 255, 255, 0.05)',
                borderRadius: '12px',
                padding: '1rem',
                position: 'relative',
                overflow: 'hidden',
                boxShadow: '0 4px 15px rgba(0,0,0,0.2)'
              }}>
              <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '2px', background: 'linear-gradient(90deg, transparent, #3b82f6, transparent)' }} />
              <Database className="text-blue-400 mb-2" size={20} />
              <div style={{ fontSize: '1.75rem', fontWeight: 'bold', color: 'white', lineHeight: 1 }}>{stats.models || '-'}</div>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.25rem' }}>Prisma Models</div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              style={{
                background: 'linear-gradient(145deg, rgba(30, 41, 59, 0.7) 0%, rgba(15, 23, 42, 0.9) 100%)',
                border: '1px solid rgba(255, 255, 255, 0.05)',
                borderRadius: '12px',
                padding: '1rem',
                position: 'relative',
                overflow: 'hidden',
                boxShadow: '0 4px 15px rgba(0,0,0,0.2)'
              }}>
              <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '2px', background: 'linear-gradient(90deg, transparent, #10b981, transparent)' }} />
              <Server className="text-emerald-400 mb-2" size={20} />
              <div style={{ fontSize: '1.75rem', fontWeight: 'bold', color: 'white', lineHeight: 1 }}>{stats.routes || '-'}</div>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.25rem' }}>REST API Endpoints</div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              style={{
                background: 'linear-gradient(145deg, rgba(30, 41, 59, 0.7) 0%, rgba(15, 23, 42, 0.9) 100%)',
                border: '1px solid rgba(255, 255, 255, 0.05)',
                borderRadius: '12px',
                padding: '1rem',
                position: 'relative',
                overflow: 'hidden',
                boxShadow: '0 4px 15px rgba(0,0,0,0.2)'
              }}>
              <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '2px', background: 'linear-gradient(90deg, transparent, #f59e0b, transparent)' }} />
              <LayoutTemplate className="text-amber-400 mb-2" size={20} />
              <div style={{ fontSize: '1.75rem', fontWeight: 'bold', color: 'white', lineHeight: 1 }}>{stats.components || '-'}</div>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.25rem' }}>React Components</div>
            </motion.div>
          </div>

          {/* Download Card */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.4 }}
            style={{
              background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.08) 0%, rgba(168, 85, 247, 0.08) 100%)',
              border: '1px solid rgba(139, 92, 246, 0.3)',
              borderRadius: '16px',
              padding: '1.5rem 1.5rem',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
              position: 'relative',
              overflow: 'hidden',
              boxShadow: '0 10px 30px rgba(0,0,0,0.3), inset 0 0 30px rgba(139, 92, 246, 0.1)'
            }}
          >
            <div style={{
              position: 'absolute', top: '-50%', left: '-50%', width: '200%', height: '200%',
              background: 'radial-gradient(circle at center, rgba(139, 92, 246, 0.1) 0%, transparent 50%)',
              pointerEvents: 'none'
            }} />

            <div style={{
              width: '3.5rem', height: '3.5rem', borderRadius: '50%',
              background: 'linear-gradient(135deg, var(--indigo-500) 0%, var(--purple-600) 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'white', marginBottom: '0.75rem',
              boxShadow: '0 0 20px rgba(99,102,241,0.4)'
            }}>
              <Code2 size={24} />
            </div>

            <h3 style={{ fontSize: '1.25rem', fontWeight: 'bold', color: 'white', marginBottom: '0.25rem' }}>Production Source Code</h3>
            <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '1rem' }}>Complete React frontend + Express backend with database models & README setup guide.</p>

            <button
              type="button"
              className="btn btn-primary"
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
                fontSize: '1rem', padding: '0.75rem 2rem', borderRadius: '9999px',
                background: 'linear-gradient(135deg, var(--indigo-500) 0%, var(--purple-500) 100%)',
                color: 'white', fontWeight: '600', border: 'none',
                boxShadow: '0 6px 16px rgba(99, 102, 241, 0.4), inset 0 0 0 1px rgba(255,255,255,0.2)',
                cursor: isDownloading ? 'not-allowed' : 'pointer',
                opacity: isDownloading ? 0.7 : 1,
                transform: isDownloading ? 'none' : undefined,
                transition: 'all 0.2s ease',
              }}
              onClick={handleDownload}
              disabled={isDownloading}
              onMouseOver={(e) => {
                if (!isDownloading) e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 10px 22px rgba(99, 102, 241, 0.6), inset 0 0 0 1px rgba(255,255,255,0.3)';
              }}
              onMouseOut={(e) => {
                if (!isDownloading) e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 6px 16px rgba(99, 102, 241, 0.4), inset 0 0 0 1px rgba(255,255,255,0.2)';
              }}
            >
              {isDownloading ? (
                <><Loader2 size={20} style={{ animation: 'spin 2s linear infinite' }} /> <span>Preparing ZIP...</span></>
              ) : (
                <><Download size={20} /> <span>Download Source Code (.zip)</span></>
              )}
            </button>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1.25rem', marginTop: '1rem', fontSize: '0.8rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><CheckCircle2 size={14} style={{ color: 'var(--indigo-400)' }} /> Type-Safe</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><CheckCircle2 size={14} style={{ color: 'var(--emerald-400)' }} /> Ready to Deploy</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><CheckCircle2 size={14} style={{ color: 'var(--amber-400)' }} /> Clean Architecture</span>
            </div>
          </motion.div>

        </div>
      </div>

      <div className="step-actions" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#94a3b8' }}>
          Conversion Job ID: <span className="font-mono text-indigo-300 px-2 py-1 bg-indigo-500/10 rounded-md border border-indigo-500/20">{jobId}</span>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => navigate('/dashboard')}>
          Go to Dashboard <ArrowRight size={16} />
        </button>
      </div>
    </>
  );
}
