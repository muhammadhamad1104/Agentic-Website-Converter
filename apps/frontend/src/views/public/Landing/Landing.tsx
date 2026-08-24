import { useRef, useEffect, useState } from 'react';
import { motion, useScroll, useTransform, AnimatePresence } from 'framer-motion';
import { Link, useNavigate } from 'react-router-dom';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ArrowRight, Zap, Brain, Code2, Globe, Shield, Sparkles, Check, Play, ChevronDown, Activity, Database, GitBranch, X, Settings, Download } from 'lucide-react';
import Navbar from '../../components/Navbar/Navbar';
import Footer from '../../components/Footer/Footer';
import ParticleField from '../../components/ParticleField/ParticleField';
import { useAuthStore } from '@store/authStore';

import {
  staggerContainer, fadeInUp, fadeInLeft, fadeInRight,
} from '@design/animations';
import './Landing.css';

gsap.registerPlugin(ScrollTrigger);

// ── Animated Counter ─────────────────────────────────────────
function AnimatedCounter({ target, suffix = '', prefix = '' }: {
  target: number;
  suffix?: string;
  prefix?: string;
}) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          let start = 0;
          const duration = 2000;
          const step = target / (duration / 16);
          const timer = setInterval(() => {
            start += step;
            if (start >= target) {
              setCount(target);
              clearInterval(timer);
            } else {
              setCount(Math.floor(start));
            }
          }, 16);
          observer.disconnect();
        }
      },
      { threshold: 0.5 },
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [target]);

  return (
    <span ref={ref} style={{ fontVariantNumeric: 'tabular-nums' }}>
      {prefix}{count.toLocaleString()}{suffix}
    </span>
  );
}

// ── Feature Card ──────────────────────────────────────────────
interface FeatureCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  color: string;
  delay: number;
}

function FeatureCard({ icon, title, description, color, delay }: FeatureCardProps) {
  return (
    <motion.div
      className="feature-card"
      variants={fadeInUp}
      custom={delay}
      whileHover={{ y: -8, transition: { duration: 0.3 } }}
    >
      <div className="feature-card__icon" style={{ '--feature-color': color } as React.CSSProperties}>
        {icon}
      </div>
      <h3 className="feature-card__title">{title}</h3>
      <p className="feature-card__desc">{description}</p>
    </motion.div>
  );
}

// ── Typewriter ────────────────────────────────────────────────
const words = ['Static Sites', 'HTML Pages', 'Legacy Websites', 'WordPress Sites', 'Landing Pages'];

function TypewriterText() {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setIndex((i) => (i + 1) % words.length);
        setVisible(true);
      }, 400);
    }, 2800);
    return () => clearInterval(interval);
  }, []);

  return (
    <AnimatePresence mode="wait">
      {visible && (
        <motion.span
          key={words[index]}
          className="gradient-text-animated"
          initial={{ opacity: 0, y: 20, filter: 'blur(8px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: -20, filter: 'blur(8px)' }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        >
          {words[index]}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

// ── Main Landing Page ─────────────────────────────────────────
export default function Landing() {
  const containerRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLElement>(null);
  const [activeStep, setActiveStep] = useState(1);
  const { scrollYProgress } = useScroll();
  const heroOpacity = useTransform(scrollYProgress, [0, 0.3], [1, 0]);
  const heroY = useTransform(scrollYProgress, [0, 0.3], ['0%', '-20%']);
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'ADMIN';
  const [isLoadingPlan, setIsLoadingPlan] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState('');

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 5000);
  };

  const navigate = useNavigate();

  const handleCheckout = async (priceId: string) => {
    const token = localStorage.getItem('token');
    if (!token) {
      showToast('Please sign in to continue to checkout.');
      setTimeout(() => {
        navigate('/login');
      }, 1500);
      return;
    }

    setIsLoadingPlan(priceId);

    try {
      // With embedded Stripe Elements, we navigate directly to the checkout page
      navigate('/checkout');
    } catch (error) {
      console.error('Checkout error:', error);
      showToast('Payment service currently unavailable.');
    } finally {
      setIsLoadingPlan(null);
    }
  };

  // Step auto-cycle
  useEffect(() => {
    const timer = setInterval(() => {
      setActiveStep((s) => (s % 7) + 1);
    }, 2500);
    return () => clearInterval(timer);
  }, []);

  // GSAP ScrollTrigger for section reveals
  useGSAP(() => {
    gsap.utils.toArray('.gsap-reveal').forEach((el) => {
      gsap.from(el as Element, {
        scrollTrigger: {
          trigger: el as Element,
          start: 'top 85%',
          toggleActions: 'play none none reverse',
        },
        opacity: 0,
        y: 50,
        duration: 0.8,
        ease: 'power3.out',
      });
    });
  }, { scope: containerRef });

  const features = [
    {
      icon: <Brain size={24} />,
      title: 'AI-Powered Analysis',
      description: 'LangGraph multi-agent system crawls and semantically understands your site structure, extracting entities with LLM precision.',
      color: '#6366f1',
    },
    {
      icon: <Database size={24} />,
      title: 'Smart Schema Inference',
      description: 'Automatically infers database schemas from content patterns. Human-in-the-loop approval gate ensures accuracy.',
      color: '#818cf8',
    },
    {
      icon: <Code2 size={24} />,
      title: 'Full-Stack Code Generation',
      description: 'Generates production-ready backend APIs, frontend components, admin panels, and database migrations.',
      color: '#a5b4fc',
    },
    {
      icon: <Shield size={24} />,
      title: 'Quality Validation',
      description: 'Multi-layer validation: consistency checks, build smoke tests, and readiness scoring before packaging.',
      color: '#4f46e5',
    },
    {
      icon: <Globe size={24} />,
      title: 'Multi-LLM Failover',
      description: 'Groq → OpenAI → Gemini automatic failover. Your conversion never stops even if one provider is down.',
      color: '#c7d2fe',
    },
    {
      icon: <GitBranch size={24} />,
      title: 'Export & Deploy',
      description: 'Download a complete, deployment-ready package. One command to launch your new dynamic application.',
      color: '#4338ca',
    },
  ];

  const steps = [
    { title: 'Input URL', description: 'Paste any static website URL or upload HTML files directly.', icon: <Globe size={20} /> },
    { title: 'Configure Options', description: 'Set quality profiles, LLM models, and deployment targets.', icon: <Settings size={20} /> },
    { title: 'AI Crawls', description: 'Agent crawls all pages, extracts content blocks and assets.', icon: <Activity size={20} /> },
    { title: 'Schema Inferred', description: 'LLM analyzes content to infer database entities and fields.', icon: <Brain size={20} /> },
    { title: 'Human Approval', description: 'Review the AI\'s schema proposal, approve or modify it.', icon: <Check size={20} /> },
    { title: 'Code Generated', description: 'Full-stack application generated from verified schemas.', icon: <Code2 size={20} /> },
    { title: 'Export & Deploy', description: 'Download a complete, deployment-ready package.', icon: <Download size={20} /> },
  ];

  const stats = [
    { label: 'Sites Converted', value: 1247, suffix: '+' },
    { label: 'Schemas Inferred', value: 8934, suffix: '' },
    { label: 'Success Rate', value: 97, suffix: '%' },
    { label: 'Avg. Time', value: 45, suffix: 's', prefix: '~' },
  ];

  return (
    <div ref={containerRef} className="landing" style={{ position: 'relative' }}>
      <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', zIndex: -1 }}>
        <ParticleField />
      </div>
      <Navbar />

      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            style={{
              position: 'fixed',
              bottom: '2rem',
              right: '2rem',
              zIndex: 9999,
              background: 'var(--glass-bg)',
              backdropFilter: 'blur(20px)',
              border: '1px solid rgba(99, 102, 241, 0.4)',
              padding: '1rem 1.5rem',
              borderRadius: 'var(--radius-lg)',
              display: 'flex',
              alignItems: 'center',
              gap: '1rem',
              boxShadow: 'var(--shadow-glow)',
              color: 'var(--text-primary)',
            }}
          >
            <div style={{ flex: 1, fontWeight: 500 }}>{toastMessage}</div>
            <button 
              onClick={() => setToastMessage('')} 
              style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex' }}
            >
              <X size={16} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── HERO ──────────────────────────────────────────── */}
      <motion.section
        ref={heroRef}
        className="hero"
        style={{ opacity: heroOpacity, y: heroY }}
      >
        {/* Removed ParticleField as Scene3D handles the background better */}


        {/* Radial glow overlay */}
        <div className="hero__glow-overlay" />

        {/* Content */}
        <motion.div
          className="hero__content"
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
        >
          {/* Badge */}
          <motion.div variants={fadeInUp} className="hero__badge">
            <Sparkles size={14} className="hero__badge-icon" />
            <span>Powered by LangGraph + Multi-LLM Failover</span>
            <div className="hero__badge-dot" />
          </motion.div>

          {/* Headline */}
          <motion.h1 className="hero__title" variants={fadeInUp}>
            Convert Your{' '}
            <span className="hero__typewriter">
              <TypewriterText />
            </span>
            <br />
            into Dynamic{' '}
            <span className="gradient-text">Apps Instantly</span>
          </motion.h1>

          {/* Subtitle */}
          <motion.p className="hero__subtitle" variants={fadeInUp}>
            The world's first agentic AI platform that transforms any static website
            into a full-stack, database-driven web application — completely automatically.
          </motion.p>

          {/* CTA Buttons */}
          <motion.div className="hero__cta" variants={fadeInUp}>
            <Link to="/register" className="btn btn-primary btn-lg">
              <Zap size={18} />
              Start Converting Free
              <ArrowRight size={16} />
            </Link>
            <button className="hero__demo-btn">
              <div className="hero__demo-play">
                <Play size={14} fill="white" />
              </div>
              Watch Demo
            </button>
          </motion.div>

          {/* Trust badges */}
          <motion.div className="hero__trust" variants={fadeInUp}>
            {['LangGraph', 'GPT-4o', 'Claude 3.5', 'Kimi', 'Gemini', 'Groq', 'FastAPI'].map((tech) => (
              <span key={tech} className="hero__trust-badge">{tech}</span>
            ))}
          </motion.div>

          {/* Scroll indicator */}
          <motion.div
            className="hero__scroll"
            animate={{ y: [0, 10, 0] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            <ChevronDown size={20} />
          </motion.div>
        </motion.div>
      </motion.section>

      {/* ── STATS ─────────────────────────────────────────── */}
      <section className="stats-section gsap-reveal">
        <div className="section">
          <div className="stats-grid">
            {stats.map((stat) => (
              <div key={stat.label} className="stat-item">
                <div className="stat-item__value">
                  <AnimatedCounter
                    target={stat.value}
                    suffix={stat.suffix}
                    prefix={stat.prefix}
                  />
                </div>
                <div className="stat-item__label">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FEATURES ──────────────────────────────────────── */}
      <section className="section" id="features">
        <motion.div
          className="section__header gsap-reveal"
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7 }}
        >
          <span className="badge badge-indigo">✦ Features</span>
          <h2 className="section__title">
            Everything you need to go{' '}
            <span className="gradient-text">static → dynamic</span>
          </h2>
          <p className="section__subtitle">
            Our multi-agent AI pipeline handles the entire conversion lifecycle from
            crawling to deployment-ready code generation.
          </p>
        </motion.div>

        <motion.div
          className="features-grid"
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-100px' }}
        >
          {features.map((feature, i) => (
            <FeatureCard key={feature.title} {...feature} delay={i} />
          ))}
        </motion.div>
      </section>

      {/* ── HOW IT WORKS ──────────────────────────────────── */}
      <section className="how-section" id="how-it-works">
        <div className="section">
          <motion.div
            className="section__header"
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
          >
            <span className="badge badge-purple">⚡ Process</span>
            <h2 className="section__title">
              7 steps from{' '}
              <span className="gradient-text">static to shipped</span>
            </h2>
            <p className="section__subtitle">
              The AI agent handles the heavy lifting. You stay in control with
              human-in-the-loop approval gates.
            </p>
          </motion.div>

          <div className="steps-container">
            {/* Pipeline visualization */}
            <div className="pipeline">
              {steps.map((step, i) => (
                <motion.div
                  key={i}
                  className={`pipeline__node ${activeStep === i + 1 ? 'pipeline__node--active' : ''} ${activeStep > i + 1 ? 'pipeline__node--done' : ''}`}
                  initial={{ opacity: 0, scale: 0 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1, type: 'spring', stiffness: 200 }}
                  onClick={() => setActiveStep(i + 1)}
                >
                  <div className="pipeline__node-inner">
                    {activeStep > i + 1 ? <Check size={18} /> : step.icon}
                  </div>
                  <span className="pipeline__node-label">{step.title}</span>
                  {i < steps.length - 1 && (
                    <div className={`pipeline__edge ${activeStep > i + 1 ? 'pipeline__edge--active' : ''}`} />
                  )}
                </motion.div>
              ))}
            </div>

            {/* Active step detail */}
            <AnimatePresence mode="wait">
              <motion.div
                key={activeStep}
                className="step-detail"
                initial={{ opacity: 0, x: 20, filter: 'blur(4px)' }}
                animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.4 }}
              >
                <div className="step-detail__number">
                  {String(activeStep).padStart(2, '0')}
                </div>
                <h3 className="step-detail__title">{steps[activeStep - 1].title}</h3>
                <p className="step-detail__desc">{steps[activeStep - 1].description}</p>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </section>

      {/* ── AGENT ARCHITECTURE ────────────────────────────── */}
      <section className="section">
        <div className="architecture-showcase">
          <motion.div
            className="architecture-text"
            variants={fadeInLeft}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
          >
            <span className="badge badge-indigo">🤖 Agent Architecture</span>
            <h2 className="section__title" style={{ textAlign: 'left' }}>
              LangGraph orchestrates{' '}
              <span className="gradient-text">12 specialized nodes</span>
            </h2>
            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.8 }}>
              From crawling to validation, each node in our workflow is resilient with
              automatic retry budgets, quality gates, and human review gates.
            </p>
            <ul className="arch-list">
              {[
                'Crawl → Sitemap → Extract Content',
                'Infer Candidates → Schema Inference',
                'Schema Review Gate (Human-in-loop)',
                'Generate Backend / Frontend / Admin',
                'Validate Consistency → Build Smoke Test',
                'Package Export (ZIP)',
              ].map((item) => (
                <li key={item} className="arch-list__item">
                  <div className="arch-list__dot" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <Link to="/register" className="btn btn-primary" style={{ marginTop: '1.5rem', width: 'fit-content' }}>
              Try It Now
              <ArrowRight size={16} />
            </Link>
          </motion.div>

          <motion.div
            className="architecture-visual"
            variants={fadeInRight}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
          >
            <div className="workflow-card glass">
              <div className="workflow-header">
                <div className="workflow-dot workflow-dot--green" />
                <div className="workflow-dot workflow-dot--amber" />
                <div className="workflow-dot workflow-dot--red" />
                <span className="workflow-title">LangGraph Workflow</span>
              </div>
              <div className="workflow-nodes">
                {[
                  { name: 'crawl_site', status: 'done', color: '#818cf8' },
                  { name: 'extract_content', status: 'done', color: '#818cf8' },
                  { name: 'infer_schema', status: 'running', color: '#6366f1' },
                  { name: 'schema_review_gate', status: 'pending', color: '#475569' },
                  { name: 'generate_backend', status: 'pending', color: '#475569' },
                  { name: 'generate_frontend', status: 'pending', color: '#475569' },
                  { name: 'validate_consistency', status: 'pending', color: '#475569' },
                  { name: 'package_export', status: 'pending', color: '#475569' },
                ].map((node, i) => (
                  <motion.div
                    key={node.name}
                    className={`workflow-node workflow-node--${node.status}`}
                    initial={{ opacity: 0, x: -20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.08 }}
                  >
                    <div
                      className="workflow-node__dot"
                      style={{ background: node.color }}
                    >
                      {node.status === 'running' && (
                        <div className="workflow-node__pulse" />
                      )}
                    </div>
                    <span className="workflow-node__name font-mono">{node.name}</span>
                    <span className={`workflow-node__status badge badge-${node.status === 'done' ? 'indigo' : node.status === 'running' ? 'indigo' : 'indigo'}`}>
                      {node.status}
                    </span>
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── PRICING / CTA ─────────────────────────────────── */}
      <section className="section" id="pricing" style={{ paddingBottom: 0 }}>
        <motion.div
          className="section__header gsap-reveal"
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7 }}
        >
          <span className="badge badge-indigo">Pricing</span>
          <h2 className="section__title">
            Simple, <span className="gradient-text">transparent</span> pricing
          </h2>
          <p className="section__subtitle">
            Because this is a Final Year Project, everything is currently free to use!
          </p>
        </motion.div>

        <div className="pricing-grid gsap-reveal">
          <div className="pricing-card">
            <h3 className="pricing-card__title">Academic / Tester</h3>
            <div className="pricing-card__price">$0<span>/forever</span></div>
            <ul className="pricing-card__features">
              <li><Check size={16} className="pricing-card__icon"/> 5 Site Conversions / day</li>
              <li><Check size={16} className="pricing-card__icon"/> Groq & Gemini Models</li>
              <li><Check size={16} className="pricing-card__icon"/> Basic Schema Inference</li>
              <li><Check size={16} className="pricing-card__icon"/> Community Support</li>
            </ul>
            {isAdmin ? (
              <button disabled className="btn btn-secondary" style={{ width: '100%', justifyContent: 'center', opacity: 0.7, cursor: 'not-allowed' }}>Admin Access</button>
            ) : (
              <Link to="/register" className="btn btn-secondary" style={{ width: '100%', justifyContent: 'center' }}>Get Started</Link>
            )}
          </div>
          <div className="pricing-card pricing-card--popular">
            <h3 className="pricing-card__title">Pro Researcher</h3>
            <div className="pricing-card__price">$29<span>/mo</span></div>
            <ul className="pricing-card__features">
              <li><Check size={16} className="pricing-card__icon"/> Unlimited Conversions</li>
              <li><Check size={16} className="pricing-card__icon"/> GPT-4o, Claude 3.5, & Kimi</li>
              <li><Check size={16} className="pricing-card__icon"/> Advanced Schema Editing</li>
              <li><Check size={16} className="pricing-card__icon"/> Full Source Code ZIP Export</li>
            </ul>
            {isAdmin ? (
              <button disabled className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', opacity: 0.7, cursor: 'not-allowed' }}>Admin Access</button>
            ) : (
              <button 
                onClick={() => handleCheckout('pro')} 
                disabled={isLoadingPlan !== null}
                className="btn btn-primary" 
                style={{ width: '100%', justifyContent: 'center' }}
              >
                {isLoadingPlan !== null ? 'Loading...' : 'Start Pro Free'}
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="cta-section">
        <div className="section">
          <motion.div
            className="cta-box glass-glow"
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
          >
            {/* Background orbs */}
            <div className="orb" style={{ width: 300, height: 300, background: '#6366f1', left: '-10%', top: '-50%' }} />
            <div className="orb" style={{ width: 200, height: 200, background: '#4f46e5', right: '-5%', bottom: '-40%' }} />

            <div className="cta-box__content">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
              >
                <span className="badge badge-indigo">🚀 Get Started Today</span>
              </motion.div>
              <h2 className="cta-box__title">
                Ready to make your site{' '}
                <span className="gradient-text-animated">dynamic?</span>
              </h2>
              <p className="cta-box__subtitle">
                Join hundreds of developers converting their static sites with AI.
                No credit card required — first conversion is free.
              </p>
              <div className="cta-box__actions">
                <Link to="/register" className="btn btn-primary btn-lg">
                  <Sparkles size={18} />
                  Start Free Conversion
                  <ArrowRight size={16} />
                </Link>
                <Link to="/login" className="btn btn-secondary btn-lg">
                  Already have an account? Sign In
                </Link>
              </div>
              <div className="cta-box__features">
                {['Free first conversion', 'No credit card', 'Download your code', 'Full ownership'].map((item) => (
                  <div key={item} className="cta-feature">
                    <Check size={14} className="cta-feature__icon" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── FOOTER ────────────────────────────────────────── */}
      <Footer />
    </div>
  );
}
