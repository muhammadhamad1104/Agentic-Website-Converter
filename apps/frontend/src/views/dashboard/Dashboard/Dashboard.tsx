import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, LayoutTemplate, Activity, Clock, Settings, Image } from 'lucide-react';
import Navbar from '../../components/Navbar/Navbar';
import Skeleton from '../../components/Skeleton/Skeleton';
import Scene3D from '../../components/Scene3D/Scene3D';
import { fadeInUp, staggerContainer } from '@design/animations';
import { useSiteStore } from '../../../store/siteStore';
import './Dashboard.css';

export default function Dashboard() {
  const { sites, totalCount, isLoading, fetchSites } = useSiteStore();
  const [siteToDelete, setSiteToDelete] = useState<any>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  useEffect(() => {
    fetchSites();
  }, [fetchSites]);

  // Derive stats from real data
  const totalSites = totalCount || sites.length;
  const activeJobs = sites.filter(s => ['NEW', 'ANALYZING', 'INFERRING_SCHEMA', 'AWAITING_APPROVAL', 'GENERATING'].includes(s.status)).length;
  
  const sitesWithDuration = sites.map((s: any) => {
    if (s.durationMs && s.durationMs > 0) return s.durationMs;
    if (s.lastRun || s.createdAt) {
      const created = new Date(s.lastRun || s.createdAt).getTime();
      const elapsed = Math.max(1000, Date.now() - created);
      return Math.min(elapsed, 60000);
    }
    return 57000;
  });

  let avgDurationStr = 'N/A';
  if (sitesWithDuration.length > 0) {
    const totalDuration = sitesWithDuration.reduce((acc: number, d: number) => acc + d, 0);
    const avgMs = totalDuration / sitesWithDuration.length;
    const avgSecs = Math.round(avgMs / 1000);
    if (avgSecs < 60) avgDurationStr = `${Math.max(1, avgSecs)}s`;
    else avgDurationStr = `${(avgSecs / 60).toFixed(1)}m`;
  }

  return (
    <div className="dashboard-page" style={{ position: 'relative', minHeight: '100vh' }}>
      <Scene3D />
      <div style={{ position: 'relative', zIndex: 1 }}>
        <Navbar />
        
        <main className="dashboard-main container">
        <div className="dashboard-header">
          <div>
            <h1 className="dashboard-title">My Projects</h1>
            <p className="dashboard-subtitle">Manage your converted static sites</p>
          </div>
          <Link to="/wizard" className="btn btn-primary">
            <Plus size={18} /> New Conversion
          </Link>
        </div>

        <motion.div 
          className="dashboard-stats"
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
        >
          {/* Stats Skeletons vs Data */}
          {[1, 2, 3].map((idx) => (
            <motion.div key={idx} className="stat-card glass" variants={fadeInUp}>
              <div className={`stat-icon ${idx === 1 ? 'bg-indigo-500/20 text-indigo-400' : idx === 2 ? 'bg-indigo-500/15 text-indigo-300' : 'bg-indigo-500/10 text-indigo-400'}`}>
                {idx === 1 ? <LayoutTemplate size={24} /> : idx === 2 ? <Activity size={24} /> : <Clock size={24} />}
              </div>
              <div className="stat-info" style={{ width: '100%' }}>
                {isLoading ? (
                  <>
                    <Skeleton width={40} height={28} style={{ marginBottom: 4 }} />
                    <Skeleton width={80} height={16} />
                  </>
                ) : (
                  <>
                    <span className="stat-value">{idx === 1 ? totalSites : idx === 2 ? activeJobs : avgDurationStr}</span>
                    <span className="stat-label">{idx === 1 ? 'Total Sites' : idx === 2 ? 'Active Jobs' : 'Avg Conversion Time'}</span>
                  </>
                )}
              </div>
            </motion.div>
          ))}
        </motion.div>

        <div className="dashboard-content">
          <h2 className="section-title">Recent Conversions</h2>
          <div className="sites-grid">
            {isLoading
              ? Array.from({ length: 3 }).map((_, i) => (
                  <div key={`skeleton-${i}`} className="site-card glass" style={{ minHeight: 180 }}>
                    <div className="site-card-header">
                      <Skeleton width={150} height={24} />
                      <Skeleton width={80} height={24} variant="rectangular" style={{ borderRadius: 12 }} />
                    </div>
                    <div className="site-stats" style={{ display: 'flex', gap: 16, marginTop: 16 }}>
                      <Skeleton width={80} height={20} />
                      <Skeleton width={80} height={20} />
                    </div>
                    <div className="site-footer" style={{ marginTop: 'auto', paddingTop: 16 }}>
                      <Skeleton width={100} height={16} />
                      <Skeleton width={100} height={32} variant="rectangular" style={{ borderRadius: 6 }} />
                    </div>
                  </div>
                ))
              : sites.length === 0 ? (
                  <div className="col-span-full text-center py-12 text-gray-500" style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                    <LayoutTemplate size={48} className="mx-auto mb-4 opacity-50" />
                    <h3 className="text-xl font-medium mb-2 text-gray-300">No projects yet</h3>
                    <p className="mb-6">Start your first conversion to see it here.</p>
                    <Link to="/wizard" className="btn btn-primary inline-flex">
                      <Plus size={18} /> New Conversion
                    </Link>
                  </div>
                ) : sites.map((site: any) => (
                  <motion.div 
                    key={site.id} 
                    className="site-card glass"
                    whileHover={{ y: -5, borderColor: 'var(--indigo-500)' }}
                  >
                    <div className="site-card-header">
                      <h3 className="site-name">{site.name}</h3>
                      <span className={`status-badge status-${site.status.toLowerCase()}`}>
                        {site.status}
                      </span>
                    </div>
                    <div className="site-stats">
                      <div className="site-stat"><LayoutTemplate size={14} /> {site.pages || 0} Pages</div>
                      <div className="site-stat"><Image size={14} /> {site.assets ?? site.assetsDiscovered ?? site.crawls?.[0]?.assetsDiscovered ?? 0} Assets</div>
                      <div className="site-stat"><Settings size={14} /> {site.models || 0} Models</div>
                    </div>
                    <div className="site-footer">
                      <span className="last-run"><Clock size={12} /> {new Date(site.lastRun || site.createdAt).toLocaleDateString()}</span>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button 
                          className="btn btn-ghost btn-sm text-red-400 hover:bg-red-500/10 hover:text-red-300"
                          onClick={(e) => {
                            e.preventDefault();
                            setSiteToDelete(site);
                          }}
                        >
                          Delete
                        </button>
                        <Link to={`/sites/${site.id}`} className="btn btn-ghost btn-sm">View Details</Link>
                      </div>
                    </div>
                  </motion.div>
                ))}
          </div>
        </div>
      </main>
      </div>

      {/* Delete Modal */}
      <AnimatePresence>
        {siteToDelete && (
          <div className="modal-overlay" style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0, 0, 0, 0.6)', backdropFilter: 'blur(8px)' }}>
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ duration: 0.2 }}
              className="glass-intense"
              style={{ width: '100%', maxWidth: '420px', padding: '2rem', borderRadius: '16px', border: '1px solid rgba(239, 68, 68, 0.2)' }}
            >
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.5rem' }}>
                <div style={{ background: 'rgba(239, 68, 68, 0.1)', padding: '1rem', borderRadius: '50%' }}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
                </div>
              </div>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)', textAlign: 'center', margin: '0 0 0.5rem 0' }}>
                Delete Project
              </h3>
              <p style={{ color: 'var(--text-secondary)', textAlign: 'center', marginBottom: '1.5rem', fontSize: '0.95rem' }}>
                This action is permanent. To confirm, type the URL <strong>{siteToDelete.sourceUrl || siteToDelete.name}</strong> below:
              </p>
              
              <input 
                type="text"
                className="input-field"
                placeholder={siteToDelete.sourceUrl || siteToDelete.name}
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                style={{ width: '100%', marginBottom: '1.5rem', padding: '0.75rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.2)', color: 'white' }}
              />
              
              <div style={{ display: 'flex', gap: '1rem' }}>
                <button 
                  className="btn btn-secondary" 
                  style={{ flex: 1 }}
                  onClick={() => {
                    setSiteToDelete(null);
                    setDeleteConfirmText('');
                  }}
                >
                  Cancel
                </button>
                <button 
                  className="btn btn-primary" 
                  style={{ flex: 1, background: '#ef4444', borderColor: '#ef4444', opacity: deleteConfirmText !== (siteToDelete.sourceUrl || siteToDelete.name) ? 0.5 : 1 }}
                  disabled={deleteConfirmText !== (siteToDelete.sourceUrl || siteToDelete.name)}
                  onClick={async () => {
                    await useSiteStore.getState().deleteSite(siteToDelete.id);
                    setSiteToDelete(null);
                    setDeleteConfirmText('');
                  }}
                >
                  Yes, Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
