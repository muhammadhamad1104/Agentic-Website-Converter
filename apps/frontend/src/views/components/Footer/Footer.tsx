import { Link } from 'react-router-dom';
import { Zap } from 'lucide-react';
import './Footer.css';

export default function Footer() {
  return (
    <footer className="footer">
      <div className="section" style={{ paddingTop: 'var(--space-12)', paddingBottom: 'var(--space-12)' }}>
        <div className="footer__grid">
          <div className="footer__brand">
            <Link to="/" className="navbar__logo" style={{ marginBottom: '1rem' }}>
              <div className="navbar__logo-icon"><Zap size={20} /></div>
              <span className="navbar__logo-text">Agentic<span className="gradient-text">Converter</span></span>
            </Link>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.7, maxWidth: 280 }}>
              AI-powered static to dynamic website converter. FYP by Muhammad Hamad.
            </p>
          </div>
          <div className="footer__links">
            <div className="footer__col">
              <h4 className="footer__col-title">Product</h4>
              <a href="#features" className="footer__link">Features</a>
              <a href="#how-it-works" className="footer__link">How It Works</a>
              <Link to="/register" className="footer__link">Get Started</Link>
            </div>
            <div className="footer__col">
              <h4 className="footer__col-title">Tech</h4>
              <a href="https://langchain.com" target="_blank" rel="noopener noreferrer" className="footer__link">LangGraph</a>
              <a href="https://openai.com" target="_blank" rel="noopener noreferrer" className="footer__link">OpenAI</a>
              <a href="https://claude.ai" target="_blank" rel="noopener noreferrer" className="footer__link">Claude 3.5</a>
              <a href="https://kimi.moonshot.cn" target="_blank" rel="noopener noreferrer" className="footer__link">Kimi</a>
              <a href="https://fastapi.tiangolo.com" target="_blank" rel="noopener noreferrer" className="footer__link">FastAPI</a>
            </div>
          </div>
        </div>
        <div className="divider" />
        <div className="footer__bottom" style={{ justifyContent: 'center' }}>
          <span>© 2026 Muhammad Hamad — BS Computer Science Final Year Project</span>
        </div>
      </div>
    </footer>
  );
}
