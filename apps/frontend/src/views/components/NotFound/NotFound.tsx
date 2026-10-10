import { lazy, Suspense, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight } from 'lucide-react';
import { useAuthStore } from '../../../store/authStore';
import Navbar from '../Navbar/Navbar';
import './NotFound.css';

const CinematicScene = lazy(() => import('../CinematicScene/CinematicScene'));

export default function NotFound() {
  const authenticated = useAuthStore(state => state.isAuthenticated);
  const navigate = useNavigate();
  const destination = authenticated ? '/dashboard' : '/';
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    const title = document.title;
    document.title = 'Page not found | Agentic Converter';
    return () => { document.title = title; };
  }, []);
  return <div className="not-found">
    <Navbar dark />
    <div className="not-found-scene" aria-hidden="true"><Suspense fallback={null}><CinematicScene compact /></Suspense></div>
    <main className="not-found-content"><p className="eyebrow">404 / PAGE NOT FOUND</p><h1>A different<br /><em>direction.</em></h1>
      <p className="not-found-description">This page is no longer here, or the address isn't quite right.</p>
      <div className="not-found-actions"><Link to={destination} className="not-found-primary">{authenticated ? 'Open your workspace' : 'Back to home'}<ArrowUpRight size={18} /></Link>
        <button className="not-found-back" onClick={() => window.history.state?.idx > 0 ? navigate(-1) : navigate(destination, { replace: true })}><ArrowLeft size={15} />Go back</button></div>
    </main>
  </div>;
}
