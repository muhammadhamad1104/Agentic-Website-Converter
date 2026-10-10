import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Landing from './Landing';
import { useResource } from '../../../hooks/useResource';
import { useAuthStore } from '../../../store/authStore';
import type { User } from '../../../types/auth';

vi.mock('../../../hooks/useResource', () => ({ useResource: vi.fn() }));
vi.mock('../../components/CinematicScene/CinematicScene', () => ({ default: () => <div>Website scene</div> }));
const plans = {
  STARTER: { name: 'Starter', conversionLimit: 5, priceCents: 0, billing: 'free' },
  PRO: { name: 'Pro', conversionLimit: null, priceCents: 19900, billing: 'one-time' },
};
const show = () => render(<MemoryRouter><Landing /></MemoryRouter>);
const member = (plan: string, role: User['role'] = 'OWNER'): User => ({ id: 'member', name: 'Test Member', email: 'member@example.invalid', plan, role, status: 'ACTIVE', mfaEnabled: false, lastLogin: null, createdAt: '', updatedAt: '' });

describe('Public homepage', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, isAuthenticated: false, token: null, isLoading: false });
    vi.mocked(useResource).mockReturnValue({ data: { plans }, error: '', loading: false, refresh: vi.fn() });
  });
  it('keeps the conversion story navigable and routes visitors to registration', () => {
    show();
    const story = screen.getByRole('navigation', { name: 'Conversion story' });
    expect(within(story).getAllByRole('link')).toHaveLength(3);
    expect(within(story).getByRole('link', { name: /Under the surface/ })).toHaveAttribute('href', '#how-it-works');
    expect(screen.getByRole('link', { name: /Start a conversion/ })).toHaveAttribute('href', '/register');
  });
  it('renders pricing from the catalog instead of a hardcoded offer', () => {
    vi.mocked(useResource).mockReturnValue({ data: { plans: { ...plans, PRO: { ...plans.PRO, priceCents: 24900 } } }, error: '', loading: false, refresh: vi.fn() });
    show();
    expect(screen.getByText('$249')).toBeInTheDocument();
    expect(screen.queryByText('$199')).not.toBeInTheDocument();
    expect(screen.getByText('5 total conversions')).toBeInTheDocument();
    expect(screen.getByText('Unlimited conversions')).toBeInTheDocument();
  });
  it('does not show invented pricing when the catalog cannot load', () => {
    vi.mocked(useResource).mockReturnValue({ data: null, error: 'Unavailable', loading: false, refresh: vi.fn() });
    show();
    expect(screen.getByRole('alert')).toHaveTextContent('Pricing is temporarily unavailable.');
    expect(screen.queryByText('$199')).not.toBeInTheDocument();
  });
  it('makes Starter non-clickable for a signed-in Starter member and routes Pro to checkout', () => {
    useAuthStore.setState({ user: member('STARTER'), isAuthenticated: true, token: 'test-token' });
    show();
    expect(screen.getByRole('button', { name: 'Your current plan' })).toBeDisabled();
    expect(screen.queryByRole('link', { name: 'Start free' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Choose Pro' })).toHaveAttribute('href', '/checkout');
  });
  it('does not offer duplicate purchases or downgrades to Pro members', () => {
    useAuthStore.setState({ user: member('PRO'), isAuthenticated: true, token: 'test-token' });
    show();
    expect(screen.getByRole('button', { name: 'Your current plan' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Included with Pro' })).toBeDisabled();
    expect(screen.queryByRole('link', { name: 'Choose Pro' })).not.toBeInTheDocument();
  });
  it('never offers paid upgrades to administrators, even when their stored plan is Starter', () => {
    useAuthStore.setState({ user: member('STARTER', 'ADMIN'), isAuthenticated: true, token: 'test-token' });
    show();
    screen.getAllByRole('button', { name: 'Administrator access' }).forEach(button => expect(button).toBeDisabled());
    expect(screen.queryByRole('link', { name: 'Choose Pro' })).not.toBeInTheDocument();
  });
  it('preserves checkout as the destination for signed-out Pro visitors', () => {
    show();
    expect(screen.getByRole('link', { name: 'Start free' })).toHaveAttribute('href', '/register');
    expect(screen.getByRole('link', { name: 'Choose Pro' })).toHaveAttribute('href', '/checkout');
  });
  it('does not route to registration while the account is being checked', () => {
    useAuthStore.setState({ isLoading: true });
    show();
    expect(screen.getAllByRole('button', { name: 'Checking your account...' })).toHaveLength(2);
    screen.getAllByRole('button', { name: 'Checking your account...' }).forEach(button => expect(button).toBeDisabled());
  });
});
