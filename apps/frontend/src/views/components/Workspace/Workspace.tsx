import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowUpRight, CreditCard, FolderOpen, LogOut, Menu, RefreshCw, ShieldCheck, UserRound, X } from 'lucide-react';
import { useAuthStore } from '../../../store/authStore';
import BrandMark from '../BrandMark/BrandMark';
import UserAvatar from '../UserAvatar/UserAvatar';
import './Workspace.css';

function WorkspaceNavigation({ close }: { close?: () => void }) {
  const user = useAuthStore(state => state.user);
  const location = useLocation();
  const admin = user?.role === 'ADMIN';
  const plan = admin ? 'Administrator' : user?.plan === 'PRO' ? 'Pro membership' : 'Starter membership';
  return <>
    <Link to="/" className="workspace-brand" onClick={close}><BrandMark size={32} /><span>Agentic<span>Converter</span></span></Link>
    <div className="workspace-nav-label">WORKSPACE</div>
    <nav className="workspace-nav" aria-label="Workspace navigation">
      <NavLink to="/dashboard" className={({ isActive }) => isActive || location.pathname.startsWith('/sites/') || location.pathname === '/wizard' ? 'active' : undefined} onClick={close}><FolderOpen size={18} />Projects<ArrowUpRight size={14} className="nav-arrow" /></NavLink>
      <NavLink to="/profile" onClick={close}><UserRound size={18} />My account<ArrowUpRight size={14} className="nav-arrow" /></NavLink>
      <NavLink to="/checkout" onClick={close}><CreditCard size={18} />Membership<ArrowUpRight size={14} className="nav-arrow" /></NavLink>
      {admin && <NavLink to="/admin" onClick={close}><ShieldCheck size={18} />Administration<ArrowUpRight size={14} className="nav-arrow" /></NavLink>}
    </nav>
    <div className="workspace-sidebar-bottom"><span className="sidebar-membership"><ShieldCheck size={15} />{plan}</span>
    </div>
  </>;
}

export function Workspace({ children }: { children: ReactNode }) {
  const { user, logout } = useAuthStore();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const section = location.pathname === '/wizard' ? 'Conversion studio' : location.pathname.startsWith('/sites/') ? 'Project overview' : location.pathname === '/admin' ? 'Administration' : location.pathname === '/checkout' ? 'Membership' : location.pathname === '/profile' ? 'My account' : 'Projects';
  useEffect(() => {
    setMenuOpen(false);
    if (!location.hash) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [location.pathname, location.hash]);
  return <div className="workspace">
    <a className="workspace-skip" href="#workspace-content">Skip to content</a>
    <aside className="workspace-sidebar"><WorkspaceNavigation /></aside>
    <div className="workspace-body">
      <header className="workspace-topbar">
        <div className="workspace-topbar-context">
          <Dialog.Root open={menuOpen} onOpenChange={setMenuOpen}>
            <Dialog.Trigger asChild><button className="icon-control workspace-menu" aria-label="Open workspace menu"><Menu size={19} /></button></Dialog.Trigger>
            <Dialog.Portal><Dialog.Overlay className="workspace-drawer-overlay" /><Dialog.Content className="workspace-drawer" aria-describedby={undefined}>
              <Dialog.Title className="sr-only">Workspace menu</Dialog.Title>
              <Dialog.Close asChild><button className="workspace-drawer-close" aria-label="Close workspace menu"><X size={20} /></button></Dialog.Close>
              <WorkspaceNavigation close={() => setMenuOpen(false)} />
            </Dialog.Content></Dialog.Portal>
          </Dialog.Root>
          <Link to="/dashboard" className="workspace-breadcrumb">Workspace</Link><span className="workspace-breadcrumb-divider">/</span><span>{section}</span>
        </div>
        <div className="workspace-topbar-account"><Link to="/profile" className="workspace-account-link" aria-label="Open your profile"><UserAvatar user={user} /><span>{user?.name || 'Your account'}</span></Link><button className="icon-control" onClick={logout} title="Sign out" aria-label="Sign out"><LogOut size={16} /></button></div>
      </header>
      <main className="workspace-main" id="workspace-content" tabIndex={-1}>{children}</main>
    </div>
  </div>;
}
export function Status({ value }: { value: string }) {
  const status = value.toLowerCase();
  const category = ['failed', 'error', 'cancelled'].includes(status) ? 'failed' : ['ready', 'validated', 'completed', 'deployed', 'active'].includes(status) ? '' : 'active';
  return <span className={'status-label ' + category}>{value.replace(/_/g, ' ').toLowerCase()}</span>;
}
export function Metrics({ items }: { items: { label: string; value: ReactNode; note?: string }[] }) {
  return <dl className="metric-band">{items.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value === 'Not measured' ? <span className="metric-unmeasured">{item.value}</span> : item.value}</dd>{item.note && <small>{item.note}</small>}</div>)}</dl>;
}
export function LoadError({ error, retry }: { error: string; retry: () => void }) {
  return <div className="notice-box error" role="alert">{error}<button className="btn btn-ghost btn-sm" onClick={retry}><RefreshCw size={14} />Retry</button></div>;
}
