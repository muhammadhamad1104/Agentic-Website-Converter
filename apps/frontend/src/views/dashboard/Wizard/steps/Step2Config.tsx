import { useState } from 'react';
import { ArrowRight, Loader2, Layers, Zap, Search, Globe2 } from 'lucide-react';
import api from '../../../../services/api';
import toast from 'react-hot-toast';

interface Step2Props {
  onNext: () => void;
  onBack: () => void;
  setJobId: (id: string) => void;
  targetUrl?: string;
  siteId?: string | null;
}

const DEPTH_CONFIGS: Record<number, { depthVal: number; label: string; tag: string; icon: any; title: string; desc: string; maxPages: string }> = {
  1: {
    depthVal: 1,
    label: 'Level 1',
    tag: 'Quick Scan',
    icon: Zap,
    title: 'Level 1 ── Quick Scan',
    desc: 'Fast exploration targeting root homepage and primary navigation links (Depth 1). Automatically extracts media assets and infers core data models.',
    maxPages: '⚡ Up to 20 Pages Max'
  },
  2: {
    depthVal: 2,
    label: 'Level 2 (Recommended)',
    tag: 'Deep Exploration',
    icon: Search,
    title: 'Level 2 ── Deep Exploration',
    desc: 'Deep exploration crawling primary navigation, sub-pages, categories, and media assets (Depth 2). Infers foreign-key relational schema across models.',
    maxPages: '🔍 Up to 50 Pages Max'
  },
  3: {
    depthVal: 3,
    label: 'Level 3',
    tag: 'Exhaustive Audit',
    icon: Globe2,
    title: 'Level 3 ── Exhaustive Audit',
    desc: 'Exhaustive full website scan following deep nested routes, documentation, and asset links (Depth 3). Infers comprehensive multi-entity schema.',
    maxPages: '🌐 Up to 100 Pages Max'
  }
};

export default function Step2Config({ onNext, setJobId, targetUrl, siteId }: Step2Props) {
  const [level, setLevel] = useState<number>(2);
  const [isStarting, setIsStarting] = useState(false);

  const isBlocked = (!targetUrl && !siteId) || isStarting;
  const activeConfig = DEPTH_CONFIGS[level] || DEPTH_CONFIGS[2];
  const ActiveIcon = activeConfig.icon;

  const handleStartAgent = async () => {
    if (!targetUrl && !siteId) {
      toast.error("Missing website target URL. Please go back to Step 1.");
      return;
    }

    setIsStarting(true);
    try {
      const actualCrawlDepth = activeConfig.depthVal;

      const { data } = await api.post('/jobs', {
        siteId: siteId || undefined,
        url: targetUrl,
        crawlDepth: actualCrawlDepth,
        extractImages: true,
        inferRelations: true
      });

      const createdJobId = data.job?.id || siteId;
      if (createdJobId) {
        setJobId(createdJobId);
      }

      toast.success(`Agent initialized! ${activeConfig.title} active.`);
      onNext();
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || err.response?.data?.message || err.message || "Failed to start agent job";
      toast.error(errorMsg);
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <>
      <div className="step-header" style={{ marginBottom: '1rem' }}>
        <h2 className="step-title">Configure Crawler & AI Agent</h2>
        <p className="step-subtitle">Select how deeply the AI agent will explore and analyze your website (3 Levels).</p>
      </div>

      <div className="step-content" style={{ display: 'flex', flexDirection: 'column', justifyItems: 'center', overflow: 'hidden' }}>
        <div style={{ maxWidth: '640px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.25rem', width: '100%' }}>
          
          {/* Level Selection Tabs Container */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <label style={{ fontSize: '14px', fontWeight: 700, color: '#ffffff', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Layers size={16} style={{ color: '#818cf8' }} />
              Select Crawl Depth Level
            </label>

            {/* Segmented Tabs Control */}
            <div style={{
              background: 'rgba(15, 23, 42, 0.8)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '14px',
              padding: '6px',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '8px'
            }}>
              {[1, 2, 3].map((lvl) => {
                const isActive = level === lvl;
                return (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => setLevel(lvl)}
                    style={{
                      background: isActive ? '#4f46e5' : 'transparent',
                      color: isActive ? '#ffffff' : '#94a3b8',
                      borderRadius: '10px',
                      padding: '12px 14px',
                      fontWeight: 700,
                      fontFamily: 'monospace',
                      fontSize: '13px',
                      textAlign: 'center',
                      cursor: 'pointer',
                      border: 'none',
                      boxShadow: isActive ? '0 4px 14px rgba(79, 70, 229, 0.4)' : 'none',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    Level {lvl} {lvl === 2 ? '(Rec)' : ''}
                  </button>
                );
              })}
            </div>

            {/* SINGLE Active Level Card (Fixed 210px Height across all levels for 100% visual consistency) */}
            <div style={{
              background: 'linear-gradient(135deg, rgba(30, 27, 75, 0.7) 0%, rgba(15, 23, 42, 0.85) 100%)',
              border: '1px solid rgba(99, 102, 241, 0.5)',
              borderRadius: '16px',
              padding: '1.5rem 1.75rem',
              boxShadow: '0 10px 30px rgba(0, 0, 0, 0.5)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              minHeight: '210px',
              boxSizing: 'border-box'
            }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0 }}>
                  <div style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: '14px',
                    background: 'rgba(99, 102, 241, 0.2)',
                    border: '1px solid rgba(129, 140, 248, 0.4)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#818cf8',
                    flexShrink: 0
                  }}>
                    <ActiveIcon size={24} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <h4 style={{ fontSize: '16px', fontWeight: 700, color: '#ffffff', margin: 0, lineHeight: 1.2 }}>
                      {activeConfig.title}
                    </h4>
                    <span style={{
                      display: 'inline-block',
                      marginTop: '6px',
                      fontSize: '11px',
                      fontFamily: 'monospace',
                      padding: '3px 10px',
                      borderRadius: '6px',
                      background: 'rgba(99, 102, 241, 0.2)',
                      color: '#a5b4fc',
                      border: '1px solid rgba(99, 102, 241, 0.4)'
                    }}>
                      {activeConfig.tag}
                    </span>
                  </div>
                </div>

                <span style={{
                  fontSize: '13px',
                  fontFamily: 'monospace',
                  fontWeight: 700,
                  padding: '8px 14px',
                  borderRadius: '10px',
                  background: 'rgba(16, 185, 129, 0.15)',
                  border: '1px solid rgba(16, 185, 129, 0.4)',
                  color: '#34d399',
                  flexShrink: 0,
                  whiteSpace: 'nowrap'
                }}>
                  {activeConfig.maxPages}
                </span>
              </div>

              <p style={{
                color: '#cbd5e1',
                fontSize: '14px',
                lineHeight: 1.6,
                margin: 0,
                paddingTop: '1rem',
                borderTop: '1px solid rgba(255, 255, 255, 0.1)'
              }}>
                {activeConfig.desc}
              </p>
            </div>
          </div>

        </div>
      </div>

      <div className="step-actions" style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', paddingTop: '1rem' }}>
        <button 
          type="button" 
          onClick={(e) => {
            if (isBlocked) {
              e.preventDefault();
              toast.error("Missing website target URL. Please go back to Step 1.");
            } else {
              handleStartAgent();
            }
          }}
          className={`btn btn-primary h-12 px-6 font-semibold flex items-center gap-2 ${
            isBlocked ? 'cursor-prohibited-red' : 'shadow-lg shadow-indigo-500/20'
          }`}
        >
          {isStarting ? (
            <><Loader2 size={18} className="animate-spin" /> Launching Agent...</>
          ) : (
            <><ArrowRight size={18} /> Start Agent (Level {level})</>
          )}
        </button>
      </div>
    </>
  );
}
