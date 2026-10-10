import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, ArrowRight, Loader2 } from 'lucide-react';
import { useAuthStore } from '../../../store/authStore';
import AuthFrame from './AuthFrame';

export default function AccountForm({ signup = false }: { signup?: boolean }) {
  const auth = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError('');
    const data = new FormData(event.currentTarget);
    const payload = { email: String(data.get('email')).trim(), password: String(data.get('password')) };
    try {
      if (signup) await auth.register({ ...payload, name: String(data.get('name')).trim() });
      else await auth.login(payload);
      const from = location.state?.from;
      navigate(typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') ? from : '/dashboard');
    } catch (problem: any) { setError(problem.response?.data?.error || 'Unable to continue. Please try again.'); }
  };
  return <AuthFrame title={signup ? 'Make it your own.' : 'Welcome back.'} subtitle={signup ? 'Create your account.' : 'Sign in to your workspace.'}>
    <form className="account-fields" onSubmit={submit}>
      {signup && <label>Full name<input name="name" className="input" required maxLength={120} autoComplete="name" /></label>}
      <label>Email address<input name="email" type="email" className="input" required autoComplete="email" /></label>
      <label>Password<div className="input-wrapper"><input name="password" type={visible ? 'text' : 'password'} className="input input--with-action"
        required minLength={signup ? 12 : 1} maxLength={256} autoComplete={signup ? 'new-password' : 'current-password'} placeholder={signup ? 'At least 12 characters' : undefined} />
        <button className="input-action" type="button" onClick={() => setVisible(value => !value)} aria-label={visible ? 'Hide password' : 'Show password'} title={visible ? 'Hide password' : 'Show password'}>
          {visible ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>
      {!signup && <Link to="/forgot-password" className="account-forgot">Forgot password?</Link>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="btn btn-primary" disabled={auth.isLoading}>{auth.isLoading ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}{signup ? 'Create account' : 'Sign in'}</button>
    </form>
    <p className="account-switch">{signup ? 'Already have an account?' : 'New here?'} <Link to={signup ? '/login' : '/register'} state={location.state}>{signup ? 'Sign in' : 'Create an account'}</Link></p>
  </AuthFrame>;
}
