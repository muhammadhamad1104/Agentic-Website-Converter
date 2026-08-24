import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { Eye, EyeOff, Mail, Lock, Zap, ArrowRight, Sparkles } from 'lucide-react';
import { useAuthStore } from '@store/authStore';
import { fadeInUp, staggerContainer, fadeInRight } from '@design/animations';


import Scene3D from '../../components/Scene3D/Scene3D';

const schema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

type FormData = z.infer<typeof schema>;

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, isLoading } = useAuthStore();
  const [showPassword, setShowPassword] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (data: FormData) => {
    try {
      await login(data);
      toast.success('Successfully logged in!', { duration: 3000 });
      const from = location.state?.from || '/dashboard';
      navigate(from);
    } catch {
      // Error handled by axios interceptor
    }
  };

  return (
    <div className="auth-page" style={{ position: 'relative' }}>
      {/* 3D Background */}
      <Scene3D />

      <div className="auth-layout" style={{ position: 'relative', zIndex: 1 }}>
        {/* Left Panel */}
        <motion.div
          className="auth-panel auth-panel--left"
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
        >
          <Link to="/" className="auth-logo">
            <div className="navbar__logo-icon"><Zap size={22} /></div>
            <span className="navbar__logo-text">
              Agentic<span className="gradient-text">Converter</span>
            </span>
          </Link>

          <motion.div className="auth-hero" variants={fadeInUp}>
            <h2 className="auth-hero__title">
              Transform static<br />
              <span className="gradient-text-animated">into dynamic</span>
            </h2>
            <p className="auth-hero__subtitle">
              Sign in to access your AI-powered conversion dashboard and manage all your converted sites.
            </p>
          </motion.div>

          <motion.div className="auth-features" variants={staggerContainer}>
            {[
              { icon: '🤖', text: 'AI-powered LangGraph workflow' },
              { icon: '⚡', text: 'Multi-LLM failover (Groq/GPT/Gemini)' },
              { icon: '🔒', text: 'Human-in-the-loop approval gates' },
              { icon: '📦', text: 'Export deployment-ready packages' },
            ].map((feature) => (
              <motion.div key={feature.text} className="auth-feature" variants={fadeInUp}>
                <span className="auth-feature__icon">{feature.icon}</span>
                <span>{feature.text}</span>
              </motion.div>
            ))}
          </motion.div>
        </motion.div>

        {/* Right Panel - Form */}
        <motion.div
          className="auth-panel auth-panel--right"
          variants={fadeInRight}
          initial="hidden"
          animate="visible"
        >
          <div className="auth-form-card glass-intense">
            {/* Header */}
            <div className="auth-form-header">
              <h1 className="auth-form-title">Welcome back</h1>
              <p className="auth-form-subtitle">
                Sign in to your account to continue
              </p>
            </div>

            {/* Form */}
            <form className="auth-form" onSubmit={handleSubmit(onSubmit)}>
              {/* Email */}
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
                  <motion.span
                    className="form-error"
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    {errors.email.message}
                  </motion.span>
                )}
              </div>

              {/* Password */}
              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label className="label" htmlFor="password">Password</label>
                  <Link to="/forgot-password" className="auth-forgot">Forgot password?</Link>
                </div>
                <div className="input-wrapper">
                  <Lock size={16} className="input-icon" />
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    className={`input input--with-icon input--with-action ${errors.password ? 'input--error' : ''}`}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    {...register('password')}
                  />
                  <button
                    type="button"
                    className="input-action"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {errors.password && (
                  <motion.span className="form-error" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                    {errors.password.message}
                  </motion.span>
                )}
              </div>

              <motion.button
                type="submit"
                className="btn btn-primary w-full"
                style={{ marginTop: 8, height: 48, fontSize: '1rem' }}
                disabled={isLoading}
                whileHover={{ scale: isLoading ? 1 : 1.01 }}
                whileTap={{ scale: isLoading ? 1 : 0.98 }}
              >
                {isLoading ? (
                  <div className="btn-spinner" />
                ) : (
                  <>
                    Sign In
                    <ArrowRight size={16} />
                  </>
                )}
              </motion.button>
            </form>

            {/* Divider */}
            <div className="auth-divider">
              <div className="auth-divider__line" />
              <span>or</span>
              <div className="auth-divider__line" />
            </div>

            {/* Sign Up Link */}
            <p className="auth-switch">
              Don't have an account?{' '}
              <Link to="/register" className="auth-switch__link">
                <Sparkles size={13} />
                Create account
              </Link>
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
