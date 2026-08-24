import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import App from './App';

// Mock the components so we don't have to render their complex 3D scenes during simple route tests
vi.mock('./views/public/Landing/Landing', () => ({
  default: () => <div data-testid="landing-page">Landing</div>
}));

vi.mock('./views/auth/Login/Login', () => ({
  default: () => <div data-testid="login-page">Login</div>
}));

vi.mock('./views/auth/Register/Register', () => ({
  default: () => <div data-testid="register-page">Register</div>
}));

vi.mock('./views/auth/ForgotPassword/ForgotPassword', () => ({
  default: () => <div data-testid="forgot-password-page">Forgot Password</div>
}));

vi.mock('./views/auth/ResetPassword/ResetPassword', () => ({
  default: () => <div data-testid="reset-password-page">Reset Password</div>
}));

vi.mock('./views/dashboard/Dashboard/Dashboard', () => ({
  default: () => <div data-testid="dashboard-page">Dashboard</div>
}));

vi.mock('./views/dashboard/SiteDetails/SiteDetails', () => ({
  default: () => <div data-testid="site-details-page">Site Details</div>
}));

vi.mock('./views/dashboard/Wizard/Wizard', () => ({
  default: () => <div data-testid="wizard-page">Wizard</div>
}));

vi.mock('./views/components/NotFound/NotFound', () => ({
  default: () => <div data-testid="not-found-page">404</div>
}));

describe('App Routing', () => {
  it('renders Landing page on default route', () => {
    window.history.pushState({}, 'Test', '/');
    render(<App />);
    expect(screen.getByTestId('landing-page')).toBeInTheDocument();
  });

  it('renders Login page on /login route', () => {
    window.history.pushState({}, 'Test', '/login');
    render(<App />);
    expect(screen.getByTestId('login-page')).toBeInTheDocument();
  });

  it('renders Wizard page on /wizard route', () => {
    window.history.pushState({}, 'Test', '/wizard');
    render(<App />);
    expect(screen.getByTestId('wizard-page')).toBeInTheDocument();
  });

  it('renders NotFound page on unknown route', () => {
    window.history.pushState({}, 'Test', '/unknown-route-123');
    render(<App />);
    expect(screen.getByTestId('not-found-page')).toBeInTheDocument();
  });
});
