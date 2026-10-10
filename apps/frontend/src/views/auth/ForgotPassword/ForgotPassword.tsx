import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Loader2, Mail, MailCheck, RefreshCw } from 'lucide-react';
import AuthFrame from '../../components/AuthFrame/AuthFrame';
import api from '../../../services/api';
import { useResource } from '../../../hooks/useResource';

export default function ForgotPassword() {
  const options = useResource<{ available: boolean; supportEmail: string | null }>('/auth/recovery-options');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  return <AuthFrame title={sent ? 'Check your inbox.' : 'Account recovery.'} subtitle={sent ? 'A fresh start, securely.' : 'A reset link, sent to your email.'}>
    {sent ? <div className="account-recovery-state" role="status"><MailCheck size={34} strokeWidth={1.3} /><p>If an active account uses this email, you will receive a reset link shortly.</p><Link to="/login" className="btn btn-secondary">Back to sign in <ArrowRight size={16} /></Link></div> : options.loading ?
      <p className="account-recovery-loading" role="status"><Loader2 size={16} className="animate-spin" />Checking recovery availability...</p> : options.error ?
      <div className="account-recovery-state"><p role="alert">{options.error}</p><button className="btn btn-secondary" onClick={options.refresh}><RefreshCw size={16} />Try again</button></div> : !options.data?.available ?
      <div className="account-recovery-state" role="status"><Mail size={32} strokeWidth={1.3} /><p>Email recovery is currently unavailable. Please try again later.</p></div> :
      <form className="account-fields" onSubmit={async event => {
        event.preventDefault(); if (submitting.current) return;
        submitting.current = true; setBusy(true); setError('');
        try { await api.post('/auth/forgot-password', { email: email.trim() }); setSent(true); setEmail(''); }
        catch (problem: any) { setError(problem.response?.data?.error || 'Unable to request a reset link. Please try again.'); }
        finally { submitting.current = false; setBusy(false); }
      }}>
        <label>Email address<input className="input" type="email" autoComplete="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} disabled={busy} /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="btn btn-primary" disabled={busy}>{busy ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}{busy ? 'Sending request...' : 'Send reset link'}</button>
      </form>}
    {!sent && <p className="account-switch">Remember your password? <Link to="/login">Sign in</Link></p>}
    {options.data?.supportEmail && <a className="account-support" href={'mailto:' + options.data.supportEmail}><Mail size={14} />Contact support</a>}
  </AuthFrame>;
}
