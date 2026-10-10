import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import AccountForm from './AccountForm';
import { useAuthStore } from '../../../store/authStore';

vi.mock('./AuthFrame', () => ({ default: ({ children, title }: any) => <div><h1>{title}</h1>{children}</div> }));
const originalRegister = useAuthStore.getState().register;
afterEach(() => useAuthStore.setState({ register: originalRegister, isLoading: false }));

it('keeps a Pro checkout destination when switching from login to registration', async () => {
  const register = vi.fn().mockResolvedValue(undefined);
  useAuthStore.setState({ register, isLoading: false });
  render(<MemoryRouter initialEntries={[{ pathname: '/login', state: { from: '/checkout' } }]}><Routes>
    <Route path="/login" element={<AccountForm />} /><Route path="/register" element={<AccountForm signup />} />
    <Route path="/checkout" element={<div>Pro checkout</div>} /><Route path="/dashboard" element={<div>Projects</div>} />
  </Routes></MemoryRouter>);
  fireEvent.click(screen.getByRole('link', { name: 'Create an account' }));
  fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'New Member' } });
  fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'new@example.invalid' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'long-enough-test-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
  expect(await screen.findByText('Pro checkout')).toBeInTheDocument();
  expect(register).toHaveBeenCalledWith({ name: 'New Member', email: 'new@example.invalid', password: 'long-enough-test-password' });
});
