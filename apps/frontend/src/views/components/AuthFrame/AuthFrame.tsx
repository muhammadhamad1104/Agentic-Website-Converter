import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import BrandMark from '../BrandMark/BrandMark';
import { lazy, Suspense } from 'react';
import './AuthFrame.css';
const CinematicScene = lazy(() => import('../CinematicScene/CinematicScene'));

export default function AuthFrame({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return <main className="account-page">
    <section className="account-art">
      <Link to="/" className="account-brand"><BrandMark /><span>Agentic <span>Converter</span></span></Link>
      <div className="account-heading"><p className="eyebrow">A NEW CHAPTER</p><h2>Make room<br /><em>for possibility.</em></h2></div>
      <div className="account-scene"><Suspense fallback={null}><CinematicScene compact /></Suspense></div>
    </section>
    <section className="account-form-section"><Link className="account-back" to="/"><ArrowLeft size={16} />Back to home</Link>
      <div className="account-form"><p className="eyebrow"><span />YOUR WORKSPACE</p><h1>{title}</h1><p className="account-subtitle">{subtitle}</p>{children}</div>
    </section>
  </main>;
}
