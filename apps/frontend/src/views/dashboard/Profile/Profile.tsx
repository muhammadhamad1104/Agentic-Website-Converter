import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import * as Tabs from '@radix-ui/react-tabs';
import { ArrowRight, Camera, CheckCircle2, Loader2, Save, ShieldCheck, Trash2 } from 'lucide-react';
import { useAuthStore } from '../../../store/authStore';
import { useResource, duration, AccountSummary } from '../../../hooks/useResource';
import { Workspace, Metrics, LoadError } from '../../components/Workspace/Workspace';
import PasswordField from '../../components/AuthFrame/PasswordField';
import UserAvatar from '../../components/UserAvatar/UserAvatar';

function ProfilePhoto() {
  const { user, updatePhotoAsync } = useAuthStore();
  const picker = useRef<HTMLInputElement>(null);
  const changing = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const change = async (file: File | null) => {
    if (changing.current) return;
    setError('');
    if (file && file.size > 5 * 1024 * 1024) { setError('Profile photos must be 5 MB or smaller.'); return; }
    changing.current = true; setBusy(true);
    try { await updatePhotoAsync(file); }
    catch (problem: any) { setError(problem.response?.data?.error || problem.message || 'Unable to update your photo.'); }
    finally { changing.current = false; setBusy(false); }
  };
  return <div className="profile-photo-section">
    <div className="account-identity"><UserAvatar user={user} className="workspace-avatar profile-photo" /><div>
      <div className="profile-photo-actions"><button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => picker.current?.click()}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}{busy ? 'Updating...' : user?.avatarUrl ? 'Change photo' : 'Add photo'}</button>
        {user?.avatarUrl && <button type="button" className="icon-control" disabled={busy} onClick={() => change(null)} title="Remove profile photo" aria-label="Remove profile photo"><Trash2 size={14} /></button>}
      </div></div></div>
    <input ref={picker} type="file" hidden aria-label="Choose profile photo" accept="image/jpeg,image/png,image/webp,image/gif" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void change(file); }} />
    <p className="photo-hint">JPG, PNG, WebP or GIF / up to 5 MB</p>
    {error && <p className="notice-box error" role="alert">{error}</p>}
  </div>;
}

function PasswordSettings() {
  const update = useAuthStore(state => state.updateProfileAsync);
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const submitting = useRef(false);
  return <div className="profile-security">
    <form className="profile-form" onSubmit={async event => {
      event.preventDefault(); if (submitting.current) return;
      setDone(false); setError('');
      if (password !== confirm) { setError('Passwords do not match.'); return; }
      submitting.current = true; setBusy(true);
      try { await update({ currentPassword: current, password, confirmPassword: confirm }); setCurrent(''); setPassword(''); setConfirm(''); setDone(true); }
      catch (problem: any) { setError(problem.response?.data?.error || 'Unable to change your password.'); }
      finally { submitting.current = false; setBusy(false); }
    }}>
      <PasswordField label="Current password" value={current} onChange={setCurrent} current disabled={busy} />
      <PasswordField label="New password" value={password} onChange={setPassword} disabled={busy} />
      <PasswordField label="Confirm new password" value={confirm} onChange={setConfirm} disabled={busy} />
      {error && <p className="notice-box error" role="alert">{error}</p>}
      {done && <p className="profile-password-done" role="status"><CheckCircle2 size={16} />Password changed. Other sessions are signed out.</p>}
      <button className="btn btn-primary" disabled={busy}><ShieldCheck size={16} />{busy ? 'Updating password...' : 'Change password'}</button>
    </form>
  </div>;
}

export default function Profile() {
  const { user, updateProfileAsync } = useAuthStore();
  const resource = useResource<AccountSummary>('/account/summary', 15000);
  const [name, setName] = useState(user?.name || '');
  const location = useLocation();
  const [section, setSection] = useState(location.hash === '#security' ? 'security' : 'details');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setName(user?.name || ''); }, [user?.name]);
  useEffect(() => { if (location.hash === '#security') setSection('security'); }, [location.hash]);
  useEffect(() => { if (location.hash === '#security' && section === 'security') document.getElementById('security')?.scrollIntoView(); }, [location.hash, section]);
  const plan = resource.data?.plan;
  const stats = resource.data?.stats;
  return <Workspace><div className="workspace-title"><div><h1>Personal <em>space.</em></h1></div><span className="status-label">{user?.role === 'ADMIN' ? 'Administrator' : plan?.name || 'Loading plan'}</span></div>
    {resource.error && <LoadError error={resource.error} retry={resource.refresh} />}
    <Metrics items={[{ label: 'Total conversions', value: plan?.used ?? '--' }, { label: 'Completed jobs', value: stats?.completedJobs ?? '--' }, { label: 'Projects', value: stats?.totalSites ?? '--' }, { label: 'Average processing time', value: stats ? duration(stats.averageDurationMs) : '--', note: stats ? stats.timedConversions + ' measured jobs' : undefined }]} />
    <Tabs.Root className="workspace-tabs profile-tabs" value={section} onValueChange={setSection}>
      <Tabs.List className="workspace-tab-list" aria-label="Account settings"><Tabs.Trigger value="details">Personal details</Tabs.Trigger><Tabs.Trigger value="security">Security</Tabs.Trigger><Tabs.Trigger value="membership">Membership</Tabs.Trigger></Tabs.List>
      <Tabs.Content value="details" className="workspace-tab-panel"><div className="profile-details-layout">
      <ProfilePhoto />
      <form className="profile-form" onSubmit={async event => {
        event.preventDefault(); setSaving(true); setError('');
        try { await updateProfileAsync({ name: name.trim() }); }
        catch (problem: any) { setError(problem.response?.data?.error || 'Unable to update your profile.'); }
        finally { setSaving(false); }
      }}>
        <label>Full name<input className="input" value={name} required maxLength={120} onChange={event => setName(event.target.value)} /></label>
        <label>Email address<input className="input" value={user?.email || ''} disabled /></label>
        {error && <p className="notice-box error" role="alert">{error}</p>}
        <button className="btn btn-primary" disabled={saving || !name.trim() || name === user?.name}><Save size={16} />{saving ? 'Saving' : 'Save changes'}</button>
      </form></div></Tabs.Content>
      <Tabs.Content value="security" className="workspace-tab-panel"><div id="security"><PasswordSettings /></div></Tabs.Content>
      <Tabs.Content value="membership" className="workspace-tab-panel">
        <dl className="detail-list"><div><dt>Current plan</dt><dd>{plan?.name || '--'}</dd></div><div><dt>Conversion allowance</dt><dd>{plan ? plan.conversionLimit === null ? 'Unlimited' : plan.conversionLimit + ' total' : '--'}</dd></div><div><dt>Conversions used</dt><dd>{plan?.used ?? '--'}</dd></div><div><dt>Remaining</dt><dd>{plan ? plan.remaining === null ? 'Unlimited' : plan.remaining : '--'}</dd></div><div><dt>Member since</dt><dd>{user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : '--'}</dd></div></dl>
        {plan?.conversionLimit !== null && plan && <progress className="usage-meter" aria-label="Conversion usage" value={Math.min(plan.used, plan.conversionLimit)} max={plan.conversionLimit} />}
        {plan?.key === 'STARTER' && <Link to="/checkout" className="btn btn-primary">Upgrade to Pro <ArrowRight size={16} /></Link>}
        {plan?.key === 'ADMIN' && <Link to="/admin" className="btn btn-secondary" style={{ marginTop: 24 }}>Administration <ArrowRight size={16} /></Link>}
      </Tabs.Content>
    </Tabs.Root>
  </Workspace>;
}
