import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { Eye, EyeOff, Mail, Lock, User, Zap, ArrowRight, Globe, Cpu, UserCheck, Download } from 'lucide-react';
import { useAuthStore } from '@store/authStore';
import { fadeInUp, staggerContainer, fadeInLeft } from '@design/animations';


import Scene3D from '../../components/Scene3D/Scene3D';

const schema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
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

export default function Register() {
  const navigate = useNavigate();
  const { register: registerUser, isLoading } = useAuthStore();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const { register, handleSubmit, watch, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const password = watch('password', '');

  const getStrength = (pwd: string): { label: string; color: string; width: string } => {
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
    try {
      await registerUser({ name: data.name, email: data.email, password: data.password });
      toast.success('Successfully registered!', { duration: 3000 });
      navigate('/dashboard');
    } catch {
      // Error handled by axios interceptor
    }
  };

  return (
    <div className="auth-page register-page" style={{ position: 'relative' }}>
      {/* 3D Background */}
      <Scene3D />

      <div className="auth-layout auth-layout--reversed" style={{ position: 'relative', zIndex: 1 }}>
        {/* Form Panel */}
        <motion.div
          className="auth-panel auth-panel--right"
          variants={fadeInLeft}
          initial="hidden"
          animate="visible"
        >
          <div className="auth-form-card register-card glass-intense">
            <div className="auth-form-header" style={{ marginBottom: '1rem' }}>
              <Link to="/" className="auth-logo auth-logo--centered" style={{ marginBottom: '1rem' }}>
                <div className="navbar__logo-icon"><Zap size={20} /></div>
                <span className="navbar__logo-text">AgenticConverter</span>
              </Link>
              <h1 className="auth-form-title" style={{ fontSize: '1.5rem' }}>Create your account</h1>
              <p className="auth-form-subtitle" style={{ fontSize: '0.85rem' }}>Start converting sites in seconds.</p>
            </div>

            <form className="auth-form register-form" onSubmit={handleSubmit(onSubmit)}>
              {/* Name */}
              <div className="form-group" style={{ marginBottom: '1rem' }}>
                <label className="label" htmlFor="name">Full name</label>
                <div className="input-wrapper">
                  <User size={16} className="input-icon" />
                  <input
                    id="name"
                    type="text"
                    className={`input input--with-icon ${errors.name ? 'input--error' : ''}`}
                    placeholder="Muhammad Hamad"
                    autoComplete="name"
                    {...register('name')}
                  />
                </div>
                {errors.name && <span className="form-error">{errors.name.message}</span>}
              </div>

              {/* Email */}
              <div className="form-group" style={{ marginBottom: '1rem' }}>
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
                {errors.email && <span className="form-error">{errors.email.message}</span>}
              </div>

              {/* Password */}
              <div className="form-group" style={{ marginBottom: '1rem' }}>
                <label className="label" htmlFor="password">Password</label>
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
                {/* Strength meter */}
                {strength && (
                  <motion.div className="password-strength" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                    <div className="password-strength__bar">
                      <motion.div
                        className="password-strength__fill"
                        style={{ background: strength.color }}
                        initial={{ width: 0 }}
                        animate={{ width: strength.width }}
                        transition={{ duration: 0.4 }}
                      />
                    </div>
                    <span className="password-strength__label" style={{ color: strength.color }}>
                      {strength.label}
                    </span>
                  </motion.div>
                )}
                {errors.password && <span className="form-error">{errors.password.message}</span>}
              </div>

              {/* Confirm Password */}
              <div className="form-group" style={{ marginBottom: '1rem' }}>
                <label className="label" htmlFor="confirmPassword">Confirm password</label>
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

              <p className="auth-terms" style={{ fontSize: '0.8rem', marginBottom: '1.25rem', marginTop: '0.5rem' }}>
                By creating an account, you agree to our{' '}
                <a href="#" className="auth-terms__link">Terms of Service</a> and{' '}
                <a href="#" className="auth-terms__link">Privacy Policy</a>.
              </p>

              <motion.button
                type="submit"
                className="btn btn-primary w-full"
                style={{ height: 48, fontSize: '1rem' }}
                disabled={isLoading}
                whileHover={{ scale: isLoading ? 1 : 1.01 }}
                whileTap={{ scale: isLoading ? 1 : 0.98 }}
              >
                {isLoading ? (
                  <div className="btn-spinner" />
                ) : (
                  <>
                    Create Account
                    <ArrowRight size={16} />
                  </>
                )}
              </motion.button>
            </form>

            <p className="auth-switch" style={{ marginTop: '1.5rem' }}>
              Already have an account?{' '}
              <Link to="/login" className="auth-switch__link">Sign In</Link>
            </p>
          </div>
        </motion.div>

        {/* Right info panel */}
        <motion.div
          className="auth-panel auth-panel--left"
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
        >
          <motion.div className="auth-hero" variants={fadeInUp}>
            <h2 className="auth-hero__title">
              Your AI conversion<br />
              <span className="gradient-text-animated">starts here</span>
            </h2>
            <p className="auth-hero__subtitle">
              Join hundreds of developers using AI to modernize their static sites into
              full-stack applications without writing a single line of backend code.
            </p>
          </motion.div>

          <motion.div className="auth-features" variants={staggerContainer} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {[
              { icon: <Globe size={20} className="text-indigo-400" />, text: 'Enter static URL or upload' },
              { icon: <Cpu size={20} className="text-indigo-400" />, text: 'AI analyzes & converts schema' },
              { icon: <UserCheck size={20} className="text-indigo-300" />, text: 'Human-in-the-loop review' },
              { icon: <Download size={20} className="text-pink-400" />, text: 'Download full-stack app' },
            ].map((feature, idx) => (
              <motion.div key={idx} className="auth-feature" variants={fadeInUp} style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1rem', background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                <span className="auth-feature__icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)' }}>{feature.icon}</span>
                <span style={{ fontSize: '0.95rem', fontWeight: 500 }}>{feature.text}</span>
              </motion.div>
            ))}
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}
