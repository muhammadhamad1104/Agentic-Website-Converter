import { useEffect, useRef, useState } from 'react';
import { PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { Link } from 'react-router-dom';
import { ArrowUpRight, CheckCircle2, Loader2, LockKeyhole, RefreshCw } from 'lucide-react';
import api from '../../../services/api';
import { useAuthStore } from '../../../store/authStore';

export default function CheckoutForm({ amountCents, currency, clientSecret, email }: { amountCents: number; currency: string; clientSecret: string; email?: string }) {
  const stripe = useStripe(); const elements = useElements();
  const [busy, setBusy] = useState(false); const submitting = useRef(false);
  const [paid, setPaid] = useState(false); const [processing, setProcessing] = useState(false);
  const [active, setActive] = useState(false); const [error, setError] = useState('');
  const [ready, setReady] = useState(false); const [loadFailed, setLoadFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!paid || active) return;
    let mounted = true; let running = false;
    const check = async () => {
      if (running) return;
      running = true;
      try {
        const result = await api.get('/auth/me');
        if (mounted && result.data.user.plan === 'PRO') { useAuthStore.getState().updateUser(result.data.user); setActive(true); }
      } catch { /* Keep the paid state visible while verification catches up. */ }
      finally { running = false; }
    };
    void check(); const timer = window.setInterval(check, 3000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, [paid, active]);
  useEffect(() => {
    if (!processing || !stripe) return;
    let mounted = true; let running = false;
    const check = async () => {
      if (running) return;
      running = true;
      try {
        const result = await stripe.retrievePaymentIntent(clientSecret);
        if (!mounted) return;
        if (result.paymentIntent?.status === 'succeeded') { setPaid(true); setProcessing(false); }
        else if (result.paymentIntent?.status === 'requires_payment_method') {
          setProcessing(false); setReady(false); setRevision(value => value + 1);
          setError('The payment was not completed. Please choose a payment method.');
        }
      } catch { /* Do not enable another payment while its outcome is unknown. */ }
      finally { running = false; }
    };
    void check(); const timer = window.setInterval(check, 3000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, [processing, stripe, clientSecret]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!stripe || !elements || !ready || loadFailed || submitting.current) return;
    submitting.current = true; setBusy(true); setError('');
    try {
      const result = await stripe.confirmPayment({ elements, confirmParams: { return_url: window.location.origin + '/profile' }, redirect: 'if_required' });
      if (result.error) setError(result.error.message || 'Payment failed.');
      else if (result.paymentIntent?.status === 'succeeded') setPaid(true);
      else { setProcessing(true); }
    } catch { setError('Unable to confirm payment. Check your account before retrying.'); }
    finally { submitting.current = false; setBusy(false); }
  };
  if (paid || processing) return <div className="checkout-state paid" aria-live="polite">
    {processing ? <Loader2 size={35} className="animate-spin" /> : <CheckCircle2 size={38} strokeWidth={1.2} />}
    <p className="eyebrow">{active ? 'UNLIMITED ACCESS' : 'PAYMENT STATUS'}</p>
    <h2>{active ? 'Pro is active.' : paid ? 'Payment received.' : 'Payment is processing.'}</h2>
    <p>{active ? 'Your conversions are unlimited.' : paid ? 'Waiting for payment verification. Your account updates automatically.' : 'Your payment is being confirmed. Check your account before making another payment.'}</p>
    <Link to="/profile" className="checkout-command">Open account <ArrowUpRight size={18} /></Link>
  </div>;
  const price = new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(amountCents / 100);
  return <form className="checkout-payment-form" onSubmit={submit}>
    {!ready && !loadFailed && <p className="checkout-form-loading" role="status"><Loader2 size={15} className="animate-spin" />Loading payment methods...</p>}
    <PaymentElement key={revision} options={{ layout: { type: 'accordion', defaultCollapsed: false }, defaultValues: { billingDetails: { email } } }}
      onReady={() => { setReady(true); setLoadFailed(false); }}
      onLoadError={event => { setReady(false); setLoadFailed(true); setError(event.error.message || 'Payment methods could not load. Please try again.'); }} />
    {error && <div className="notice-box error" role="alert">{error}</div>}
    {loadFailed && <button type="button" className="checkout-form-retry" onClick={() => { setError(''); setLoadFailed(false); setReady(false); setRevision(value => value + 1); }}><RefreshCw size={14} />Reload payment form</button>}
    <button className="checkout-command" disabled={busy || !ready || loadFailed || !stripe || !elements}>{busy ? <><Loader2 className="animate-spin" size={16} />Confirming payment...</> : <>Pay {price}<ArrowUpRight size={18} /></>}</button>
    <p className="checkout-stripe"><LockKeyhole size={12} />Secured by Stripe. One-time payment.</p>
  </form>;
}
