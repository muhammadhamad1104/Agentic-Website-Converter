import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Mail, Shield, Zap, Settings, ArrowLeft, Save, X } from 'lucide-react';
import { useAuthStore } from '@store/authStore';
import { useSiteStore } from '../../../store/siteStore';
import { fadeInUp, staggerContainer, fadeInRight } from '@design/animations';
import Scene3D from '../../components/Scene3D/Scene3D';
import toast from 'react-hot-toast';

export default function Profile() {
  const { user, updateProfileAsync } = useAuthStore();
  const { sites, fetchSites } = useSiteStore();
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(user?.name || '');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetchSites();
  }, [fetchSites]);

  const handleSave = async () => {
    try {
      setIsSubmitting(true);
      const payload: any = {};
      if (name && name !== user?.name) payload.name = name;
      if (password) payload.password = password;
      
      if (Object.keys(payload).length > 0) {
        await updateProfileAsync(payload);
      } else {
        toast('No changes made');
      }
      setIsEditing(false);
      setPassword('');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to update profile');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="auth-page" style={{ position: 'relative' }}>
      <Scene3D />

      <div className="auth-layout" style={{ position: 'relative', zIndex: 1, maxWidth: '1200px', margin: '0 auto', display: 'flex', alignItems: 'center', minHeight: '100vh', padding: '0 2rem', flexWrap: 'wrap', gap: '2rem' }}>
        
        {/* Left Side: Navigation & Info */}
        <motion.div
          className="auth-panel auth-panel--left"
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          style={{ flex: '1 1 300px', minWidth: '300px' }}
        >
          <Link to="/dashboard" className="auth-logo" style={{ marginBottom: '2rem', display: 'inline-flex' }}>
            <div className="navbar__logo-icon"><ArrowLeft size={22} /></div>
            <span className="navbar__logo-text">
              Back to <span className="gradient-text">Dashboard</span>
            </span>
          </Link>

          <motion.div className="auth-hero" variants={fadeInUp}>
            <h2 className="auth-hero__title">
              Your<br />
              <span className="gradient-text-animated">Profile</span>
            </h2>
            <p className="auth-hero__subtitle" style={{ marginTop: '1rem' }}>
              Manage your personal information, subscription, and account settings.
            </p>
          </motion.div>

          <motion.div className="auth-features" variants={staggerContainer} style={{ marginTop: '2rem' }}>
            {user?.role === 'ADMIN' ? (
              <motion.div className="auth-feature" variants={fadeInUp}>
                <span className="auth-feature__icon">🛡️</span>
                <span>Access: <strong className="gradient-text">Full Admin</strong></span>
              </motion.div>
            ) : (
              <motion.div className="auth-feature" variants={fadeInUp}>
                <span className="auth-feature__icon">👑</span>
                <span>Plan: <strong className="gradient-text">{user?.plan || 'STARTER'}</strong></span>
              </motion.div>
            )}
            <motion.div className="auth-feature" variants={fadeInUp}>
              <span className="auth-feature__icon">🚀</span>
              <span>Total Conversions: <strong>{sites.length}</strong></span>
            </motion.div>
          </motion.div>
        </motion.div>

        {/* Right Side: Profile Card */}
        <motion.div
          className="auth-panel auth-panel--right"
          variants={fadeInRight}
          initial="hidden"
          animate="visible"
          style={{ flex: '1 1 500px', width: '100%', maxWidth: '500px', margin: '0 auto' }}
        >
          <div className="auth-form-card glass-intense">
            <div className="auth-form-header" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'linear-gradient(135deg, var(--indigo-500), var(--indigo-700))', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '1.5rem', fontWeight: 'bold' }}>
                {user?.name?.charAt(0).toUpperCase() || 'U'}
              </div>
              <div>
                <h1 className="auth-form-title" style={{ marginBottom: 0 }}>{user?.name || 'User Name'}</h1>
                <p className="auth-form-subtitle" style={{ marginTop: '0.25rem' }}>Account Details</p>
              </div>
            </div>

            <div style={{ marginTop: '2rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              
              {isEditing ? (
                <>
                  <div className="form-group" style={{ marginBottom: '1rem' }}>
                    <label className="auth-form-subtitle" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem' }}>Full Name</label>
                    <input 
                      type="text" 
                      className="input" 
                      value={name} 
                      onChange={(e) => setName(e.target.value)} 
                    />
                  </div>
                  <div className="form-group">
                    <label className="auth-form-subtitle" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem' }}>New Password (optional)</label>
                    <input 
                      type="password" 
                      className="input" 
                      value={password} 
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Leave blank to keep current"
                    />
                  </div>
                </>
              ) : (
                <div style={{ padding: '1rem', background: 'rgba(255, 255, 255, 0.03)', borderRadius: '12px', border: '1px solid var(--glass-border)', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <Mail size={20} style={{ color: 'var(--text-secondary)' }} />
                  <div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Email Address</div>
                    <div style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{user?.email || 'user@example.com'}</div>
                  </div>
                </div>
              )}

              <div style={{ padding: '1rem', background: 'rgba(255, 255, 255, 0.03)', borderRadius: '12px', border: '1px solid var(--glass-border)', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <Shield size={20} style={{ color: 'var(--text-secondary)' }} />
                <div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Account Role</div>
                  <div style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{user?.role || 'OWNER'}</div>
                </div>
              </div>

            </div>

            <div style={{ marginTop: '2.5rem', display: 'flex', gap: '1rem' }}>
              {isEditing ? (
                <>
                  <button onClick={() => setIsEditing(false)} className="btn btn-secondary" style={{ flex: 1, justifyContent: 'center' }}>
                    <X size={18} style={{ marginRight: '0.5rem' }}/> Cancel
                  </button>
                  <button onClick={handleSave} disabled={isSubmitting} className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }}>
                    <Save size={18} style={{ marginRight: '0.5rem' }}/> {isSubmitting ? 'Saving...' : 'Save'}
                  </button>
                </>
              ) : (
                <>
                  <button onClick={() => setIsEditing(true)} className="btn btn-secondary" style={{ flex: 1, justifyContent: 'center' }}>
                    <Settings size={18} style={{ marginRight: '0.5rem' }}/> Edit Profile
                  </button>
                  {user?.role !== 'ADMIN' && (
                    <Link to="/checkout" className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }}>
                      <Zap size={18} style={{ marginRight: '0.5rem' }}/> Upgrade
                    </Link>
                  )}
                </>
              )}
            </div>
            
          </div>
        </motion.div>
      </div>
    </div>
  );
}
