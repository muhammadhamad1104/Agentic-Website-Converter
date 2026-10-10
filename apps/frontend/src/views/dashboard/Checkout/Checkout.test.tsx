import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Checkout from './Checkout';
import { useResource } from '../../../hooks/useResource';
import api from '../../../services/api';
import { loadStripe } from '@stripe/stripe-js/pure';

vi.mock('../../../hooks/useResource', () => ({ useResource: vi.fn() }));
vi.mock('../../../services/api', () => ({ default: { post: vi.fn() } }));
vi.mock('@stripe/stripe-js/pure', () => ({ loadStripe: vi.fn() }));
vi.mock('@stripe/react-stripe-js', () => ({ Elements: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('./CheckoutForm', () => ({ default: () => <div>Secure payment fields</div> }));
const plan = { key: 'STARTER', name: 'Starter', conversionLimit: 5, used: 1, remaining: 4, canConvert: true, priceCents: 0, billing: 'free' };
let account: any;
let catalog: any;
const show = () => render(<MemoryRouter><Checkout /></MemoryRouter>);

describe('Membership checkout', () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.stubEnv('VITE_STRIPE_PUBLISHABLE_KEY', 'pk_test_browser_fixture');
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    account = { data: { plan }, error: '', loading: false, refresh: vi.fn() };
    catalog = { data: { plans: { PRO: { name: 'Pro', priceCents: 19900, currency: 'usd' } } }, error: '', loading: false, refresh: vi.fn() };
    vi.mocked(useResource).mockImplementation(path => path === '/account/summary' ? account : catalog);
    vi.mocked(api.post).mockResolvedValue({ data: { clientSecret: 'pi_fixture_secret', amount: 19900, currency: 'usd' } });
    vi.mocked(loadStripe).mockResolvedValue({} as any);
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  it('opens at the top when arriving from the homepage pricing section', () => {
    show(); expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'instant' });
  });
  it('opens Stripe only after an explicit action and uses the catalog price', async () => {
    catalog.data.plans.PRO.priceCents = 24900;
    show();
    expect(screen.getAllByText('$249')).toHaveLength(2);
    expect(api.post).not.toHaveBeenCalled(); expect(loadStripe).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));
    await screen.findByText('Secure payment fields');
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(loadStripe).toHaveBeenCalledTimes(1);
  });
  it.each(['PRO', 'ADMIN'])('does not create payments for an entitled %s account', key => {
    account.data.plan = { ...plan, key, name: key === 'ADMIN' ? 'Administrator' : 'Pro', conversionLimit: null };
    show();
    expect(screen.getByText("You're all set.")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue to payment' })).not.toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled(); expect(loadStripe).not.toHaveBeenCalled();
  });
  it('disables checkout until the current account and offer are loaded', () => {
    account.data = null;
    show(); expect(screen.getByRole('button', { name: 'Continue to payment' })).toBeDisabled();
  });
  it('never initializes Stripe when payment keys are missing', () => {
    vi.stubEnv('VITE_STRIPE_PUBLISHABLE_KEY', ''); show();
    expect(screen.getByText('Payments are unavailable.')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled(); expect(loadStripe).not.toHaveBeenCalled();
  });
  it('provides an honest retry state after an API failure', async () => {
    vi.mocked(api.post).mockRejectedValue({ response: { data: { error: 'Checkout temporarily unavailable.' } } });
    show(); fireEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));
    await screen.findByRole('alert'); expect(screen.getByRole('alert')).toHaveTextContent('Checkout temporarily unavailable.');
    expect(screen.getByRole('button', { name: 'Retry checkout' })).toBeEnabled();
    expect(loadStripe).not.toHaveBeenCalled();
  });
  it('reuses the same payment intent when Stripe could not load', async () => {
    vi.mocked(loadStripe).mockResolvedValueOnce(null).mockResolvedValueOnce({} as any);
    show(); fireEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));
    await screen.findByRole('alert'); fireEvent.click(screen.getByRole('button', { name: 'Retry checkout' }));
    await screen.findByText('Secure payment fields'); expect(api.post).toHaveBeenCalledTimes(1);
  });
  it('prevents duplicate checkout initialization while the request is pending', async () => {
    let resolve!: (value: any) => void;
    vi.mocked(api.post).mockImplementation(() => new Promise(done => { resolve = done; }));
    show(); const button = screen.getByRole('button', { name: 'Continue to payment' });
    fireEvent.click(button); fireEvent.click(button);
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Opening payment...' })).toBeDisabled();
    resolve({ data: { clientSecret: 'pi_fixture_secret', amount: 19900, currency: 'usd' } });
    await waitFor(() => expect(screen.getByText('Secure payment fields')).toBeInTheDocument());
  });
});
