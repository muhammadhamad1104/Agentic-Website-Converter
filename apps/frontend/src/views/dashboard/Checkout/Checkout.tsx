import { useState, useEffect } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements } from '@stripe/react-stripe-js';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Zap, Loader2, ArrowLeft } from 'lucide-react';
import api from '../../../services/api';
import { useAuthStore } from '@store/authStore';
import { fadeInUp, staggerContainer, fadeInRight } from '@design/animations';

import Scene3D from '../../components/Scene3D/Scene3D';
import CheckoutForm from './CheckoutForm';

// Initialize Stripe outside component render
const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || 'pk_test_dummy');

export default function Checkout() {
  const [clientSecret, setClientSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuthStore();
  const navigate = useNavigate();

  // Price of Pro Plan in cents
  const amountInCents = 19900; 

  useEffect(() => {
    // If not logged in, redirect to login
    if (!user) {
      navigate('/login', { state: { from: '/checkout' } });
      return;
    }

    const fetchPaymentIntent = async () => {
      try {
        const { data } = await api.post('/payments/create-payment-intent', { amount: amountInCents });
        if (data.clientSecret) {
          setClientSecret(data.clientSecret);
        } else {
          setError('Failed to initialize payment.');
        }
      } catch (err: any) {
        setError(err.response?.data?.error || 'Network error initializing checkout.');
      }
    };

    fetchPaymentIntent();
  }, [user, navigate, amountInCents]);

  const appearance = {
    theme: 'night' as const,
    variables: {
      colorPrimary: '#6366f1', // indigo-500
      colorBackground: 'rgba(30, 41, 59, 0.5)',
      colorText: '#f8fafc',
      colorDanger: '#ef4444',
      fontFamily: 'Inter, system-ui, sans-serif',
      spacingUnit: '4px',
      borderRadius: '12px',
    },
    rules: {
      '.Input': {
        border: '1px solid rgba(255, 255, 255, 0.1)',
        boxShadow: 'none',
      },
      '.Input:focus': {
        border: '1px solid #6366f1',
      }
    }
  };

  const options = {
    clientSecret,
    appearance,
  };

  return (
    <div className="auth-page" style={{ position: 'relative' }}>
      <Scene3D />

      <div className="auth-layout" style={{ position: 'relative', zIndex: 1, maxWidth: '1200px', margin: '0 auto', display: 'flex', alignItems: 'center', minHeight: '100vh', padding: '0 2rem' }}>
        
        {/* Left Side: Info */}
        <motion.div
          className="auth-panel auth-panel--left"
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          style={{ paddingRight: '4rem' }}
        >
          <Link to="/" className="auth-logo">
            <div className="navbar__logo-icon"><Zap size={22} /></div>
            <span className="navbar__logo-text">
              Agentic<span className="gradient-text">Converter</span>
            </span>
          </Link>

          <motion.div className="auth-hero" variants={fadeInUp}>
            <h2 className="auth-hero__title">
              Upgrade to<br />
              <span className="gradient-text-animated">Pro Researcher</span>
            </h2>
            <p className="auth-hero__subtitle" style={{ marginTop: '1rem' }}>
              Lifetime access to unlimited conversions, Claude 3.5 Sonnet, and full source code ZIP exports.
            </p>
          </motion.div>

          <motion.div variants={fadeInUp} style={{ marginTop: '2rem' }}>
            <div className="glass-intense" style={{ padding: '1.5rem', borderRadius: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.2rem', color: 'var(--text-primary)' }}>Lifetime License</h3>
                <p style={{ margin: '0.25rem 0 0 0', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>One-time payment</p>
              </div>
              <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                $199.00
              </div>
            </div>
          </motion.div>
        </motion.div>

        {/* Right Side: Payment Form */}
        <motion.div
          className="auth-panel auth-panel--right"
          variants={fadeInRight}
          initial="hidden"
          animate="visible"
          style={{ width: '100%', maxWidth: '500px' }}
        >
          <div className="auth-form-card glass-intense">
            <div className="auth-form-header">
              <h1 className="auth-form-title">Secure Checkout</h1>
              <p className="auth-form-subtitle">Complete your payment below</p>
            </div>

            {error ? (
              <div style={{ padding: '1rem', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                {error}
              </div>
            ) : !clientSecret ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '3rem 0', color: 'var(--text-secondary)' }}>
                <Loader2 className="animate-spin" size={32} style={{ marginBottom: '1rem', color: 'var(--indigo-400)' }} />
                Initializing secure connection...
              </div>
            ) : (
              <Elements options={options} stripe={stripePromise}>
                <CheckoutForm amount={amountInCents / 100} />
              </Elements>
            )}

            <div style={{ marginTop: '1.5rem', textAlign: 'center' }}>
              <button onClick={() => navigate(-1)} className="btn btn-ghost btn-sm" style={{ color: 'var(--text-secondary)' }}>
                <ArrowLeft size={16} /> Cancel and go back
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
