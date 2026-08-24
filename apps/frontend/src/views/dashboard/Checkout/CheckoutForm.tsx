import { useState } from 'react';
import { useStripe, useElements, PaymentElement } from '@stripe/react-stripe-js';
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { fadeInUp } from '@design/animations';

export default function CheckoutForm({ amount }: { amount: number }) {
  const stripe = useStripe();
  const elements = useElements();
  const navigate = useNavigate();

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setIsProcessing(true);

    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: 'if_required', // Avoids automatic redirect for SPA experience
    });

    if (error) {
      setErrorMessage(error.message || 'Payment failed');
      setIsProcessing(false);
    } else if (paymentIntent && paymentIntent.status === 'succeeded') {
      setPaymentSuccess(true);
      setIsProcessing(false);
      
      // Optionally update user store/plan status here
      // For now, redirect after a short delay
      setTimeout(() => {
        navigate('/dashboard?payment=success');
      }, 3000);
    } else {
      setErrorMessage('An unexpected error occurred.');
      setIsProcessing(false);
    }
  };

  if (paymentSuccess) {
    return (
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        style={{ textAlign: 'center', padding: '2rem 0' }}
      >
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.5rem' }}>
          <CheckCircle2 size={64} style={{ color: '#818cf8' }} />
        </div>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '1rem' }}>
          Payment Successful!
        </h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>
          Thank you for upgrading to Pro. Your lifetime access has been unlocked.
        </p>
        <button 
          onClick={() => navigate('/dashboard')}
          className="btn btn-primary"
        >
          Go to Dashboard
        </button>
      </motion.div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ width: '100%' }}>
      <div style={{ padding: '1rem', background: 'rgba(255, 255, 255, 0.03)', borderRadius: '12px', border: '1px solid var(--glass-border)', marginBottom: '1.5rem' }}>
        <PaymentElement />
      </div>

      {errorMessage && (
        <motion.div 
          variants={fadeInUp}
          initial="hidden"
          animate="visible"
          style={{ padding: '1rem', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '12px', display: 'flex', alignItems: 'flex-start', color: '#ef4444', marginBottom: '1.5rem' }}
        >
          <AlertCircle size={20} style={{ marginRight: '0.75rem', flexShrink: 0, marginTop: '2px' }} />
          <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>{errorMessage}</span>
        </motion.div>
      )}

      <button
        type="submit"
        disabled={isProcessing || !stripe || !elements}
        className="btn btn-primary w-full"
        style={{ height: '54px', fontSize: '1.1rem' }}
      >
        {isProcessing ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
            <Loader2 className="animate-spin" size={20} />
            Processing...
          </div>
        ) : (
          `Pay $${amount.toFixed(2)}`
        )}
      </button>
      
      <p style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '1rem' }}>
        Powered by Stripe. Secure encrypted transaction.
      </p>
    </form>
  );
}
