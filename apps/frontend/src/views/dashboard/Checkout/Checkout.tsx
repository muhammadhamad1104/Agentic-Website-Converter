import { useEffect, useRef, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js/pure';
import type { Appearance } from '@stripe/stripe-js';
import { Elements } from '@stripe/react-stripe-js';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, CheckCircle2, CreditCard, Layers3, Loader2, LockKeyhole, Infinity as InfinityIcon, Code2 } from 'lucide-react';
import api from '../../../services/api';
import { useAuthStore } from '../../../store/authStore';
import { useResource, type AccountSummary } from '../../../hooks/useResource';
import { Workspace, LoadError } from '../../components/Workspace/Workspace';
import CheckoutForm from './CheckoutForm';
import './Checkout.css';

const appearance: Appearance = {
  theme: 'flat', labels: 'above',
  variables: {
    colorPrimary: '#365749', colorBackground: '#ffffff', colorText: '#314139', colorTextSecondary: '#707c74',
    colorTextPlaceholder: '#869188', colorDanger: '#9b493e', borderRadius: '4px', fontFamily: 'Arial, sans-serif',
    fontSizeBase: '14px', spacingUnit: '5px', gridRowSpacing: '22px',
  },
  rules: {
    '.Input': { border: '1px solid #d6ded8', boxShadow: 'none', padding: '13px 12px' },
    '.Input:focus': { borderColor: '#678568', boxShadow: '0 0 0 1px #678568' },
    '.Label': { fontSize: '12px', fontWeight: '400', marginBottom: '8px', color: '#697c6b' },
    '.Tab': { border: '1px solid #d6ded8', boxShadow: 'none', padding: '14px' },
    '.Tab--selected': { borderColor: '#678568', backgroundColor: '#edf2ee', boxShadow: 'none' },
    '.Block': { border: '1px solid #d6ded8', boxShadow: 'none' },
  },
};
type Payment = { clientSecret: string; amount: number; currency: string };

export default function Checkout() {
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); }, []);
  const key = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
  const [stripe, setStripe] = useState<ReturnType<typeof loadStripe> | null>(null);
  const user = useAuthStore(state => state.user);
  const account = useResource<AccountSummary>('/account/summary');
  const catalog = useResource<{ plans: Record<string, { priceCents: number; currency: string; name: string }> }>('/plans');
  const [payment, setPayment] = useState<Payment | null>(null);
  const [loading, setLoading] = useState(false);
  const initializing = useRef(false);
  const [error, setError] = useState('');
  const entitled = account.data?.plan.conversionLimit === null;
  const pro = catalog.data?.plans.PRO;
  const offer = payment || (pro ? { amount: pro.priceCents, currency: pro.currency } : null);
  const price = offer ? new Intl.NumberFormat('en-US', { style: 'currency', currency: offer.currency.toUpperCase(), maximumFractionDigits: offer.amount % 100 ? 2 : 0 }).format(offer.amount / 100) : null;
  const available = Boolean(account.data && pro && !account.error && !catalog.error);
  const initialize = async () => {
    if (initializing.current || entitled || !key || !available) return;
    initializing.current = true; setLoading(true); setError('');
    try {
      const details: Payment = payment || (await api.post('/payments/create-payment-intent')).data;
      setPayment(details);
      const instance = loadStripe(key);
      if (!await instance) throw new Error('The payment form could not load. Please try again.');
      setStripe(instance);
    } catch (problem: any) {
      setError(problem.response?.data?.error || problem.message || 'Checkout is unavailable.');
    } finally { initializing.current = false; setLoading(false); }
  };
  return <div className="checkout-page"><Workspace>
    <Link to="/profile" className="checkout-back"><ArrowLeft size={15} />Your account</Link>
    <header className="checkout-intro"><div><h1>{entitled ? <>Already <em>yours.</em></> : <>Your <em>Pro</em> upgrade.</>}</h1></div><span className="checkout-secure"><LockKeyhole size={14} />{entitled ? 'UNLIMITED ACCESS' : 'SECURE CHECKOUT'}</span></header>
    {account.error && <LoadError error={account.error} retry={account.refresh} />}
    {catalog.error && <LoadError error={catalog.error} retry={catalog.refresh} />}
    <div className="checkout-layout">
      <section className="checkout-summary" aria-label="Membership summary">
        <div className="checkout-plan"><span>{entitled ? account.data?.plan.name : pro?.name || 'Pro'} membership</span></div>
        <div className="checkout-amount">{entitled ? <h2>Unlimited.</h2> : price ? <h2>{price}</h2> : <span className="checkout-price-loading" role="status">Loading your offer...</span>}<p>{entitled ? 'Your access is already included.' : <>One-time payment{offer && <span> / {offer.currency.toUpperCase()}</span>}</>}</p></div>
        <ul className="checkout-inclusions"><li><InfinityIcon size={18} strokeWidth={1.4} />Unlimited conversions</li><li><Code2 size={18} strokeWidth={1.4} />Preview & source export</li><li><Layers3 size={18} strokeWidth={1.4} />Generated admin workspace</li></ul>
        <div className="checkout-account"><span>YOUR ACCOUNT</span><p>{user?.email || 'Loading account...'}</p></div>
      </section>
      <section className="checkout-payment" aria-label="Payment">
        {entitled ? <div className="checkout-state"><CheckCircle2 size={38} strokeWidth={1.2} /><h2>You're all set.</h2><p>No payment needed.</p><Link to="/dashboard" className="checkout-command">Open workspace <ArrowUpRight size={18} /></Link></div> : <>
          <h2>Payment</h2>
          {error && <div className="notice-box error" role="alert">{error}</div>}
          {!key ? <div className="checkout-unavailable" role="status"><CreditCard size={24} strokeWidth={1.3} /><h3>Payments are unavailable.</h3><p>Please try again later.</p><Link to="/profile" className="checkout-text-link">Back to your account <ArrowUpRight size={16} /></Link></div> :
            payment && stripe ? <Elements stripe={stripe} options={{ clientSecret: payment.clientSecret, appearance }}><CheckoutForm amountCents={payment.amount} currency={payment.currency} clientSecret={payment.clientSecret} email={user?.email} /></Elements> :
              <div className="checkout-start"><dl className="checkout-order"><div className="checkout-total"><dt>Due today</dt><dd>{price || 'Loading...'}</dd></div></dl><button className="checkout-command" disabled={loading || !available} onClick={initialize}>{loading ? <><Loader2 className="animate-spin" size={17} />Opening payment...</> : <>{error ? 'Retry checkout' : 'Continue to payment'}<ArrowUpRight size={18} /></>}</button><p className="checkout-stripe"><LockKeyhole size={12} />Payment details are handled by Stripe.</p></div>}
        </>}
      </section>
    </div>
  </Workspace></div>;
}
