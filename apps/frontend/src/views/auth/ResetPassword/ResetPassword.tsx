import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Loader2, LockKeyhole } from 'lucide-react';
import AuthFrame from '../../components/AuthFrame/AuthFrame';
import PasswordField from '../../components/AuthFrame/PasswordField';
import api from '../../../services/api';
import { useAuthStore } from '../../../store/authStore';

export default function ResetPassword() {
  const location = useLocation();
  const navigate = useNavigate();
  const [token] = useState(() => new URLSearchParams(location.hash.slice(1)).get('token') || '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const valid = /^[a-f0-9]{64}$/.test(token);
  useEffect(() => { if (location.hash) navigate('/reset-password', { replace: true }); }, [location.hash, navigate]);
  return <AuthFrame title={done ? 'A fresh start.' : 'Your new password.'} subtitle={done ? 'Your password has been reset.' : 'At least 12 characters. Make it yours.'}>
    {done ? <div className="account-recovery-state" role="status"><CheckCircle2 size={34} strokeWidth={1.3} /><p>Previous sessions are signed out.</p><Link to="/login" className="btn btn-secondary">Sign in <ArrowRight size={16} /></Link></div> : !valid ?
      <div className="account-recovery-state"><LockKeyhole size={32} strokeWidth={1.3} /><p role="alert">This reset link is invalid or expired.</p><Link to="/forgot-password" className="btn btn-secondary">Request a new link <ArrowRight size={16} /></Link></div> :
      <><form className="account-fields" onSubmit={async event => {
        event.preventDefault(); if (submitting.current) return;
        if (password !== confirmPassword) { setError('Passwords do not match.'); return; }
        submitting.current = true; setBusy(true); setError('');
        try {
          await api.post('/auth/reset-password', { token, password, confirmPassword });
          setPassword(''); setConfirmPassword(''); setDone(true);
          localStorage.removeItem('token'); useAuthStore.setState({ user: null, token: null, isAuthenticated: false, isLoading: false });
        } catch (problem: any) { setError(problem.response?.data?.error || 'Unable to reset your password. Please try again.'); }
        finally { submitting.current = false; setBusy(false); }
      }}>
        <PasswordField label="New password" value={password} onChange={setPassword} disabled={busy} />
        <PasswordField label="Confirm new password" value={confirmPassword} onChange={setConfirmPassword} disabled={busy} />
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="btn btn-primary" disabled={busy}>{busy ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}{busy ? 'Updating password...' : 'Reset password'}</button>
      </form><p className="account-switch"><Link to="/forgot-password">Request a new link</Link></p></>}
  </AuthFrame>;
}
