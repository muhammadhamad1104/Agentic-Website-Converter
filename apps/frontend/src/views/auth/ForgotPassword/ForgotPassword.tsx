import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Mail, Zap, ArrowLeft, ArrowRight, CheckCircle2 } from 'lucide-react';
import api from '../../../services/api';
import { fadeInRight } from '@design/animations';


import Scene3D from '../../components/Scene3D/Scene3D';

const schema = z.object({
  email: z.string().email('Invalid email address'),
});

type FormData = z.infer<typeof schema>;

export default function ForgotPassword() {
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    setIsLoading(true);
    try {
      await api.post('/auth/forgot-password', data);
      setIsSubmitted(true);
    } catch {
      // Error toast is handled by api interceptor
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-page" style={{ position: 'relative' }}>
      {/* 3D Background */}
      <Scene3D />

      <div className="auth-layout" style={{ justifyContent: 'center', position: 'relative', zIndex: 1 }}>
        <motion.div
          className="auth-panel"
          style={{ maxWidth: 500, flex: 'none', width: '100%' }}
          variants={fadeInRight}
          initial="hidden"
          animate="visible"
        >
          <div className="auth-form-card glass-intense">
            <div className="auth-form-header">
              <Link to="/" className="auth-logo auth-logo--centered">
                <div className="navbar__logo-icon"><Zap size={20} /></div>
                <span className="navbar__logo-text">AgenticConverter</span>
              </Link>
            </div>

            <AnimatePresence mode="wait">
              {!isSubmitted ? (
                <motion.div
                  key="form"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                >
                  <div className="auth-form-header">
                    <h1 className="auth-form-title">Reset your password</h1>
                    <p className="auth-form-subtitle">
                      Enter your email address and we'll send you a link to reset your password.
                    </p>
                  </div>

                  <form className="auth-form" onSubmit={handleSubmit(onSubmit)}>
                    <div className="form-group">
                      <label className="label" htmlFor="email">Email address</label>
                      <div className="input-wrapper">
                        <Mail size={16} className="input-icon" />
                        <input
                          id="email"
                          type="email"
                          className={`input input--with-icon ${errors.email ? 'input--error' : ''}`}
                          placeholder="you@example.com"
                          autoComplete="email"
                          {...register('email')}
                        />
                      </div>
                      {errors.email && (
                        <motion.span className="form-error" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                          {errors.email.message}
                        </motion.span>
                      )}
                    </div>

                    <motion.button
                      type="submit"
                      className="btn btn-primary w-full"
                      style={{ marginTop: 16, height: 48, fontSize: '1rem' }}
                      disabled={isLoading}
                      whileHover={{ scale: isLoading ? 1 : 1.01 }}
                      whileTap={{ scale: isLoading ? 1 : 0.98 }}
                    >
                      {isLoading ? (
                        <div className="btn-spinner" />
                      ) : (
                        <>
                          Send Reset Link
                          <ArrowRight size={16} />
                        </>
                      )}
                    </motion.button>
                  </form>
                </motion.div>
              ) : (
                <motion.div
                  key="success"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  style={{ textAlign: 'center', padding: '2rem 0' }}
                >
                  <div style={{
                    width: 64, height: 64, borderRadius: '50%', background: 'rgba(16, 185, 129, 0.1)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem',
                    color: 'var(--indigo-400)'
                  }}>
                    <CheckCircle2 size={32} />
                  </div>
                  <h2 className="auth-form-title" style={{ marginBottom: '0.5rem' }}>Check your email</h2>
                  <p className="auth-form-subtitle" style={{ marginBottom: '2rem' }}>
                    We've sent a password reset link to your email address.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            <Link to="/login" className="btn btn-ghost w-full" style={{ marginTop: '2rem', justifyContent: 'center' }}>
              <ArrowLeft size={16} />
              Back to Sign In
            </Link>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

