import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CheckoutForm from './CheckoutForm';
import api from '../../../services/api';
import { useAuthStore } from '../../../store/authStore';

const mocks = vi.hoisted(() => ({ confirm: vi.fn(), retrieve: vi.fn(), callbacks: {} as any }));
vi.mock('../../../services/api', () => ({ default: { get: vi.fn() } }));
vi.mock('@stripe/react-stripe-js', () => ({
  useStripe: () => ({ confirmPayment: mocks.confirm, retrievePaymentIntent: mocks.retrieve }), useElements: () => ({}),
  PaymentElement: (props: any) => { mocks.callbacks = props; return <div data-testid="stripe-element">Stripe payment fields</div>; },
}));
const show = (currency = 'usd') => render(<MemoryRouter><CheckoutForm amountCents={19900} currency={currency} clientSecret="pi_fixture_secret" /></MemoryRouter>);
const ready = () => act(() => mocks.callbacks.onReady());
const pay = async () => { await act(async () => fireEvent.click(screen.getByRole('button', { name: /Pay / }))); };

describe('Stripe payment states', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ user: { id: 'fixture', name: 'Member', email: 'member@example.invalid', role: 'OWNER', plan: 'STARTER', status: 'ACTIVE', mfaEnabled: false, lastLogin: null, createdAt: '', updatedAt: '' }, isLoading: false });
    mocks.confirm.mockResolvedValue({ error: { message: 'Your card was declined.' } });
    mocks.retrieve.mockResolvedValue({ paymentIntent: { status: 'processing' } });
    vi.mocked(api.get).mockResolvedValue({ data: { user: { plan: 'STARTER' } } });
  });
  afterEach(() => vi.useRealTimers());
  it('waits for ready payment fields and displays the server currency', () => {
    show('gbp'); expect(screen.getByRole('button', { name: 'Pay £199.00' })).toBeDisabled();
    ready(); expect(screen.getByRole('button', { name: 'Pay £199.00' })).toBeEnabled();
  });
  it('allows payment fields to be reloaded after a loading failure', () => {
    show(); act(() => mocks.callbacks.onLoadError({ error: { message: 'Payment fields failed to load.' } }));
    expect(screen.getByRole('alert')).toHaveTextContent('Payment fields failed to load.');
    expect(screen.getByRole('button', { name: 'Pay $199.00' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Reload payment form' })); ready();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Pay $199.00' })).toBeEnabled();
  });
  it('displays declines without upgrading the account', async () => {
    show(); ready(); await pay();
    expect(screen.getByRole('alert')).toHaveTextContent('Your card was declined.');
    expect(useAuthStore.getState().user?.plan).toBe('STARTER'); expect(api.get).not.toHaveBeenCalled();
  });
  it('keeps successful payment separate from server-confirmed Pro activation', async () => {
    vi.useFakeTimers(); mocks.confirm.mockResolvedValue({ paymentIntent: { status: 'succeeded' } });
    show(); ready(); await pay();
    expect(screen.getByText('Payment received.')).toBeInTheDocument();
    expect(useAuthStore.getState().user?.plan).toBe('STARTER');
    vi.mocked(api.get).mockResolvedValue({ data: { user: { plan: 'PRO' } } });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(screen.getByText('Pro is active.')).toBeInTheDocument(); expect(useAuthStore.getState().user?.plan).toBe('PRO');
  });
  it('does not offer another payment while the first is processing', async () => {
    vi.useFakeTimers(); mocks.confirm.mockResolvedValue({ paymentIntent: { status: 'processing' } });
    show(); ready(); await pay();
    expect(screen.getByText('Payment is processing.')).toBeInTheDocument(); expect(screen.queryByRole('button', { name: /Pay / })).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
    mocks.retrieve.mockResolvedValue({ paymentIntent: { status: 'succeeded' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(screen.getByText('Payment received.')).toBeInTheDocument(); expect(mocks.confirm).toHaveBeenCalledTimes(1);
  });
});
