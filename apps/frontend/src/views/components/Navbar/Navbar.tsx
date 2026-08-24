import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Zap,
  LayoutDashboard,
  LogIn,
  LogOut,
  User,
  ChevronDown,
  Menu,
  X,
  Sparkles,
} from 'lucide-react';
import { useAuthStore } from '@store/authStore';
import './Navbar.css';

const navLinks = [
  { label: 'Features', href: '/#features' },
  { label: 'How It Works', href: '/#how-it-works' },
  { label: 'Pricing', href: '/#pricing' },
];

export default function Navbar() {
  const { isAuthenticated, user, logout } = useAuthStore();
  const location = useLocation();
  
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  const isLanding = location.pathname === '/';

  return (
    <>
      <motion.nav
        className={`navbar ${scrolled ? 'navbar--scrolled' : ''} ${!isLanding ? 'navbar--dark' : ''}`}
        initial={{ y: -80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="navbar__inner">
          {/* Logo */}
          <Link to="/" className="navbar__logo">
            <motion.div
              className="navbar__logo-icon"
              whileHover={{ scale: 1.1, rotate: 10 }}
              transition={{ type: 'spring', stiffness: 300, damping: 15 }}
            >
              <Zap size={20} />
            </motion.div>
            <span className="navbar__logo-text">
              Agentic<span className="gradient-text">Converter</span>
            </span>
          </Link>

          {/* Desktop Nav */}
          <div className="navbar__links">
            {!isAuthenticated &&
              navLinks.map((link) => (
                <motion.a
                  key={link.href}
                  href={link.href}
                  className="navbar__link"
                  whileHover={{ y: -1 }}
                  transition={{ duration: 0.15 }}
                >
                  {link.label}
                </motion.a>
              ))}

            {isAuthenticated && (
              <Link
                to="/dashboard"
                className={`navbar__link ${location.pathname.startsWith('/dashboard') ? 'navbar__link--active' : ''}`}
              >
                <LayoutDashboard size={15} />
                Dashboard
              </Link>
            )}
          </div>

          {/* Right Actions */}
          <div className="navbar__actions">
            {isAuthenticated ? (
              <div className="navbar__user" onClick={() => setUserMenuOpen(!userMenuOpen)}>
                <div className="navbar__user-avatar">
                  {user?.name?.[0]?.toUpperCase() ?? 'U'}
                </div>
                <span className="navbar__user-name">{user?.name}</span>
                <ChevronDown
                  size={14}
                  style={{
                    transform: userMenuOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                    transition: 'transform 0.2s',
                    color: 'var(--text-muted)',
                  }}
                />

                <AnimatePresence>
                  {userMenuOpen && (
                    <motion.div
                      className="navbar__user-menu"
                      initial={{ opacity: 0, y: 8, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 8, scale: 0.95 }}
                      transition={{ duration: 0.15 }}
                    >
                      <div className="navbar__user-menu-header">
                        <div className="navbar__user-avatar navbar__user-avatar--lg">
                          {user?.name?.[0]?.toUpperCase() ?? 'U'}
                        </div>
                        <div>
                          <div className="navbar__user-menu-name">{user?.name}</div>
                          <div className="navbar__user-menu-email">{user?.email}</div>
                        </div>
                      </div>
                      <div className="navbar__user-menu-divider" />
                      <Link to="/dashboard" className="navbar__user-menu-item">
                        <LayoutDashboard size={15} />
                        Dashboard
                      </Link>
                      <Link to="/profile" className="navbar__user-menu-item">
                        <User size={15} />
                        Profile
                      </Link>
                      <div className="navbar__user-menu-divider" />
                      <button className="navbar__user-menu-item navbar__user-menu-item--danger" onClick={logout}>
                        <LogOut size={15} />
                        Sign Out
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ) : (
              <>
                <Link to="/login" className="btn btn-ghost btn-sm">
                  <LogIn size={15} />
                  Sign In
                </Link>
                <Link to="/register" className="btn btn-primary btn-sm">
                  <Sparkles size={15} />
                  Get Started
                </Link>
              </>
            )}

            {/* Mobile menu toggle */}
            <button
              className="navbar__mobile-toggle"
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label="Toggle menu"
            >
              {menuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        <AnimatePresence>
          {menuOpen && (
            <motion.div
              className="navbar__mobile-menu"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              {navLinks.map((link, i) => (
                <motion.a
                  key={link.href}
                  href={link.href}
                  className="navbar__mobile-link"
                  initial={{ x: -20, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ delay: i * 0.05 }}
                  onClick={() => setMenuOpen(false)}
                >
                  {link.label}
                </motion.a>
              ))}
              {!isAuthenticated && (
                <>
                  <Link to="/login" className="btn btn-ghost btn-sm" style={{ marginTop: 8 }}>
                    Sign In
                  </Link>
                  <Link to="/register" className="btn btn-primary btn-sm">
                    Get Started Free
                  </Link>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.nav>
      {/* Overlay for user menu */}
      {userMenuOpen && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 99 }}
          onClick={() => setUserMenuOpen(false)}
        />
      )}
    </>
  );
}
