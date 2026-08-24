import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Home, ArrowLeft } from 'lucide-react';
import { fadeInUp, staggerContainer } from '@design/animations';
import Scene3D from '../../components/Scene3D/Scene3D';

export default function NotFound() {
  return (
    <div className="auth-page" style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <Scene3D />

      <div className="auth-layout" style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: '800px', margin: '0 auto', padding: '0 2rem' }}>
        
        <motion.div
          className="auth-panel"
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          style={{ width: '100%', textAlign: 'center' }}
        >
          <div className="auth-form-card glass-intense" style={{ margin: '0 auto', padding: '4rem 2rem', maxWidth: '600px' }}>
            <motion.div className="not-found__badge" variants={fadeInUp} style={{ marginBottom: '1.5rem' }}>
              <span className="badge badge-indigo">⚡ Error 404</span>
            </motion.div>

            <motion.h1 className="auth-form-title" variants={fadeInUp} style={{ fontSize: '3rem', marginBottom: '1rem' }}>
              Lost in the{' '}
              <span className="gradient-text-animated">Void</span>
            </motion.h1>

            <motion.p className="auth-form-subtitle" variants={fadeInUp} style={{ marginBottom: '3rem', maxWidth: '500px', margin: '0 auto 3rem auto', lineHeight: '1.8' }}>
              This page has been converted to digital stardust. The AI agent couldn't
              crawl it — maybe it never existed, or perhaps it became dynamic and
              transcended its static origins.
            </motion.p>

            <motion.div variants={fadeInUp} style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              <Link to="/" className="btn btn-primary btn-lg">
                <Home size={18} />
                Home
              </Link>
              <button
                className="btn btn-secondary btn-lg"
                onClick={() => window.history.back()}
              >
                <ArrowLeft size={18} />
                Go Back
              </button>
            </motion.div>

            <motion.div
              variants={fadeInUp}
              style={{ transitionDelay: '0.4s', marginTop: '3rem' }}
            >
              <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginRight: '0.5rem' }}>Error Code:</span>
              <span className="font-mono gradient-text" style={{ fontSize: '0.9rem' }}>PAGE_NOT_FOUND_IN_UNIVERSE</span>
            </motion.div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
