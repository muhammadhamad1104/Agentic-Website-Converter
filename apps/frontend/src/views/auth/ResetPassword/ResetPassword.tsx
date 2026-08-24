import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Lock, Eye, EyeOff, Zap, ArrowRight, CheckCircle2 } from 'lucide-react';
import api from '../../../services/api';
import { fadeInRight } from '@design/animations';


import Scene3D from '../../components/Scene3D/Scene3D';

const schema = z.object({
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Must contain at least one number'),
  confirmPassword: z.string(),
}).refine((d) => d.password === d.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

type FormData = z.infer<typeof schema>;

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const { register, handleSubmit, watch, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const password = watch('password', '');
  const getStrength = (pwd: string) => {
    let score = 0;
    if (pwd.length >= 8) score++;
    if (/[A-Z]/.test(pwd)) score++;
    if (/[0-9]/.test(pwd)) score++;
    if (/[^A-Za-z0-9]/.test(pwd)) score++;

    if (score <= 1) return { label: 'Weak', color: 'var(--rose-500)', width: '25%' };
    if (score === 2) return { label: 'Fair', color: 'var(--amber-500)', width: '50%' };
    if (score === 3) return { label: 'Good', color: 'var(--indigo-500)', width: '75%' };
    return { label: 'Strong', color: 'var(--emerald-500)', width: '100%' };
  };

  const strength = password ? getStrength(password) : null;

  const onSubmit = async (data: FormData) => {
    if (!token) return;
    setIsLoading(true);
    try {
      await api.post('/auth/reset-password', { token, newPassword: data.password });
      setIsSuccess(true);
    } catch {
      // Handled by interceptor
    } finally {
      setIsLoading(false);
    }
  };

  if (!token && !isSuccess) {
    return (
      <div className="auth-page" style={{ justifyContent: 'center', alignItems: 'center', position: 'relative' }}>
        <Scene3D />
        <div className="auth-form-card glass" style={{ textAlign: 'center', padding: '3rem 2rem', position: 'relative', zIndex: 1 }}>
          <h2 className="auth-form-title">Invalid Link</h2>
          <p className="auth-form-subtitle" style={{ marginBottom: '2rem' }}>
            This password reset link is invalid or has expired.
          </p>
          <Link to="/forgot-password" className="btn btn-primary">
            Request New Link
          </Link>
        </div>
      </div>
    );
  }

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
              {!isSuccess ? (
                <motion.div
                  key="form"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                >
                  <div className="auth-form-header">
                    <h1 className="auth-form-title">Set new password</h1>
                    <p className="auth-form-subtitle">
                      Please enter your new password below.
                    </p>
                  </div>

                  <form className="auth-form" onSubmit={handleSubmit(onSubmit)}>
                    <div className="form-group">
                      <label className="label" htmlFor="password">New Password</label>
                      <div className="input-wrapper">
                        <Lock size={16} className="input-icon" />
                        <input
                          id="password"
                          type={showPassword ? 'text' : 'password'}
                          className={`input input--with-icon input--with-action ${errors.password ? 'input--error' : ''}`}
                          placeholder="Min. 8 characters"
                          autoComplete="new-password"
                          {...register('password')}
                        />
                        <button type="button" className="input-action" onClick={() => setShowPassword(!showPassword)} tabIndex={-1}>
                          {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                      {strength && (
                        <motion.div className="password-strength" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                          <div className="password-strength__bar">
                            <motion.div
                              className="password-strength__fill"
                              style={{ background: strength.color, width: strength.width }}
                            />
                          </div>
                          <span className="password-strength__label" style={{ color: strength.color }}>{strength.label}</span>
                        </motion.div>
                      )}
                      {errors.password && <span className="form-error">{errors.password.message}</span>}
                    </div>

                    <div className="form-group">
                      <label className="label" htmlFor="confirmPassword">Confirm Password</label>
                      <div className="input-wrapper">
                        <Lock size={16} className="input-icon" />
                        <input
                          id="confirmPassword"
                          type={showConfirm ? 'text' : 'password'}
                          className={`input input--with-icon input--with-action ${errors.confirmPassword ? 'input--error' : ''}`}
                          placeholder="Re-enter password"
                          autoComplete="new-password"
                          {...register('confirmPassword')}
                        />
                        <button type="button" className="input-action" onClick={() => setShowConfirm(!showConfirm)} tabIndex={-1}>
                          {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                      {errors.confirmPassword && <span className="form-error">{errors.confirmPassword.message}</span>}
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
                          Update Password
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
                  <h2 className="auth-form-title" style={{ marginBottom: '0.5rem' }}>Password Updated!</h2>
                  <p className="auth-form-subtitle" style={{ marginBottom: '2rem' }}>
                    Your password has been successfully reset.
                  </p>
                  <Link to="/login" className="btn btn-primary w-full" style={{ justifyContent: 'center' }}>
                    Sign In
                  </Link>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
