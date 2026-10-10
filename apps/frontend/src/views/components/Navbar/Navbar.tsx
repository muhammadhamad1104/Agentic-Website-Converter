import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowUpRight, Menu, X, LogOut } from 'lucide-react';
import { useAuthStore } from '../../../store/authStore';
import BrandMark from '../BrandMark/BrandMark';
import UserAvatar from '../UserAvatar/UserAvatar';
import './Navbar.css';

export default function Navbar({ dark = false }: { dark?: boolean }) {
  const { user, isAuthenticated, logout } = useAuthStore();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(window.scrollY > 24);
  const landing = location.pathname === '/';
  useEffect(() => { setOpen(false); }, [location.pathname]);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 24);
    window.addEventListener('scroll', update, { passive: true }); update();
    return () => window.removeEventListener('scroll', update);
  }, [location.pathname]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, []);
  return <header className={'product-nav ' + (landing || dark ? 'on-dark ' : '') + (scrolled ? 'is-scrolled' : '')}>
    <div className="product-nav-inner">
      <Link to="/" className="product-brand"><BrandMark size={28} /><span>Agentic<span>Converter</span></span></Link>
      <nav aria-label="Main navigation" className={open ? 'open' : ''}>
        {isAuthenticated ? <>
          <Link to="/dashboard" aria-current={location.pathname === '/dashboard' ? 'page' : undefined}>Projects</Link>
          <Link to="/profile" aria-current={location.pathname === '/profile' ? 'page' : undefined}>Profile</Link>
          {user?.role === 'ADMIN' && <Link to="/admin" aria-current={location.pathname === '/admin' ? 'page' : undefined}>Administration</Link>}
        </> : <><a href="/#features">Overview</a><a href="/#how-it-works">The process</a><a href="/#pricing">Pricing</a></>}
      </nav>
      <div className="product-nav-actions">
        {isAuthenticated ? <><Link to="/profile" className="account-link"><UserAvatar user={user} className="account-initial" /><span>{user?.name}</span></Link><button className="nav-icon" onClick={logout} aria-label="Sign out" title="Sign out"><LogOut size={17} /></button></>
          : <><Link to="/login" className="nav-signin">Sign in</Link><Link to="/register" className={'btn btn-sm ' + (landing ? 'btn-lime' : 'btn-primary')}>Get started <ArrowUpRight size={16} /></Link></>}
        <button className="nav-icon mobile-menu" aria-label={open ? 'Close navigation' : 'Open navigation'} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <X size={21} /> : <Menu size={21} />}</button>
      </div>
    </div>
  </header>;
}
