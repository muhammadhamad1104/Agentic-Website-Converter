import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ArrowDown, ArrowUpRight, Check, Layers3, Code2, Database, ShieldCheck } from 'lucide-react';
import Navbar from '../../components/Navbar/Navbar';
import BrandMark from '../../components/BrandMark/BrandMark';
import { useResource } from '../../../hooks/useResource';
import { useAuthStore } from '../../../store/authStore';
import './Landing.css';

const CinematicScene = lazy(() => import('../../components/CinematicScene/CinematicScene'));
type Catalog = { plans: Record<string, { name: string; conversionLimit: number | null; priceCents: number; billing: string }> };
const chapters = [
  { title: 'The original', anchor: 'scene-original', detail: 'SOURCE / DESIGN / MEDIA' },
  { title: 'Under the surface', anchor: 'how-it-works', detail: 'CAPTURE / STRUCTURE / REVIEW' },
  { title: 'Entirely yours', anchor: 'scene-connected', detail: 'PREVIEW / EDIT / EXPORT' },
];
const capabilities = [
  { Icon: Layers3, title: 'Original character.', description: 'Your markup, styles, and media remain the starting point.' },
  { Icon: Database, title: 'New control.', description: 'Review collections. Give your content a workspace.' },
  { Icon: ShieldCheck, title: 'A clear view.', description: 'See the result, with build reports and source warnings.' },
  { Icon: Code2, title: 'Your code. Yours.', description: 'Preview your website. Take the source with you.' },
];

export default function Landing() {
  const { data, error } = useResource<Catalog>('/plans');
  const { user, isLoading } = useAuthStore();
  const sequence = useRef<HTMLElement>(null);
  const progress = useRef(0);
  const [chapter, setChapter] = useState(0);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const section = sequence.current;
      if (!section) return;
      const p = Math.max(0, Math.min(1, -section.getBoundingClientRect().top / Math.max(1, section.offsetHeight - window.innerHeight)));
      progress.current = p;
      section.style.setProperty('--sequence-progress', String(p));
      setChapter(p < .31 ? 0 : p < .7 ? 1 : 2);
    };
    const request = () => { if (!frame) frame = requestAnimationFrame(update); };
    window.addEventListener('scroll', request, { passive: true });
    window.addEventListener('resize', request); update();
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', request); window.removeEventListener('resize', request); };
  }, []);
  const start = user ? '/wizard' : '/register';
  return <div className="landing">
    <Navbar />
    <section className="cinema-sequence" ref={sequence} aria-label="From static website to editable workspace">
      <span id="scene-original" className="story-anchor original" />
      <span id="how-it-works" className="story-anchor structure" />
      <span id="scene-connected" className="story-anchor connected" />
      <div className="cinema-stage" data-chapter={chapter}>
        <div className="stage-index"><span>STATIC TO DYNAMIC</span><span>0{chapter + 1} / 03</span></div>
        <div className="cinema-media"><Suspense fallback={null}><CinematicScene progress={progress} /></Suspense></div>
        <div className={'story-copy story-original ' + (chapter === 0 ? 'is-active' : '')} aria-hidden={chapter !== 0}>
          <p className="eyebrow light">A NEW CHAPTER FOR YOUR WEBSITE</p>
          <h1>Agentic<br /><em>Converter.</em></h1>
          <p className="hero-description">The website you know.<br />The control you've been missing.</p>
          <Link to={start} className="editorial-cta">Start a conversion <span><ArrowUpRight size={19} /></span></Link>
        </div>
        <div className={'story-copy story-structure ' + (chapter === 1 ? 'is-active' : '')} aria-hidden={chapter !== 1}>
          <p className="eyebrow light">02 / UNDER THE SURFACE</p>
          <h2>Same character.<br /><em>New depth.</em></h2>
          <p className="hero-description">Pages. Media. Content.<br />A structure you can make your own.</p>
          <p className="story-note">CAPTURE &nbsp; / &nbsp; INFER &nbsp; / &nbsp; REVIEW</p>
        </div>
        <div className={'story-copy story-connected ' + (chapter === 2 ? 'is-active' : '')} aria-hidden={chapter !== 2}>
          <p className="eyebrow light">03 / YOUR NEXT CHAPTER</p>
          <h2>Still familiar.<br /><em>Entirely yours.</em></h2>
          <p className="hero-description">An editable website. A dedicated admin.<br />The freedom to keep moving.</p>
          <Link to={user ? '/dashboard' : '/register'} className="editorial-cta">Open your workspace <span><ArrowUpRight size={19} /></span></Link>
        </div>
        <div className="story-rail">
          <div className="story-progress" />
          <nav aria-label="Conversion story">{chapters.map((item, index) => <a key={item.anchor} href={'#' + item.anchor} aria-current={chapter === index ? 'step' : undefined}>
            <span className="rail-number">0{index + 1}</span><span>{item.title}</span><ArrowUpRight size={14} />
          </a>)}</nav>
          <a className="story-down" href={chapter === 2 ? '#features' : chapter === 1 ? '#scene-connected' : '#how-it-works'} aria-label="Continue to the next section"><ArrowDown size={18} /></a>
        </div>
      </div>
    </section>
    <section className="landing-band workflow-band" id="features">
      <div className="landing-inner">
        <header className="band-heading"><p className="eyebrow">THE DIFFERENCE IS UNDERNEATH</p><h2>Keep the character.<br /><em>Gain the control.</em></h2><span className="section-index">01 / THE WORKFLOW</span></header>
        <div className="capability-list">{capabilities.map(({ Icon, title, description }, index) => <article key={title}>
          <span className="capability-number">0{index + 1}</span><Icon size={22} strokeWidth={1.4} /><div><h3>{title}</h3><p>{description}</p></div>
        </article>)}</div>
      </div>
    </section>
    <section className="landing-band pricing-band" id="pricing">
      <div className="pricing-heading"><p className="eyebrow">ROOM FOR YOUR NEXT IDEA</p><h2>Your pace.<br /><em>Your plan.</em></h2><p>No subscription. No recurring payment.</p></div>
      <div className="pricing-options">{error ? <p role="alert">Pricing is temporarily unavailable.</p> : !data ? <p role="status">Loading plans...</p> : ['STARTER', 'PRO'].map(key => {
        const plan = data.plans[key];
        const activePlan = user?.plan || 'STARTER';
        const disabled = Boolean(user && (key === 'STARTER' || user.role === 'ADMIN' || activePlan === 'PRO')) || isLoading;
        const status = isLoading ? 'Checking your account...' : user?.role === 'ADMIN' ? 'Administrator access' : activePlan === key ? 'Your current plan' : 'Included with Pro';
        return <article className={'price-option ' + (key === 'PRO' ? 'featured' : '')} key={key}>
          <div className="price-top"><p className="eyebrow">{plan.name}</p><span>{key === 'PRO' ? 'For what comes next' : 'A place to begin'}</span></div>
          <div className="price-amount"><h3>{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(plan.priceCents / 100)}</h3><span>{plan.billing === 'free' ? 'Free to start' : 'One-time payment'}</span></div>
          <ul><li><Check size={15} />{plan.conversionLimit === null ? 'Unlimited conversions' : plan.conversionLimit + ' total conversions'}</li><li><Check size={15} />Generated admin workspace</li><li><Check size={15} />Preview and source export</li></ul>
          {disabled ? <button className="plan-link" disabled>{status}<Check size={18} /></button> :
            <Link className="plan-link" to={key === 'PRO' ? '/checkout' : '/register'}>{key === 'PRO' ? 'Choose Pro' : 'Start free'}<ArrowUpRight size={20} /></Link>}
        </article>;
      })}</div>
    </section>
    <footer className="product-footer">
      <Link to="/" className="footer-wordmark"><BrandMark size={26} /><span>Agentic Converter</span></Link>
      <nav aria-label="Footer"><Link to={user ? '/dashboard' : '/login'}>Your workspace <ArrowRight size={16} /></Link><a href="#scene-original">Back to top <ArrowUpRight size={14} /></a></nav>
    </footer>
  </div>;
}
