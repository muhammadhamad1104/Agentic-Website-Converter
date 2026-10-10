import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NotFound from './NotFound';
import { useAuthStore } from '../../../store/authStore';

vi.mock('../CinematicScene/CinematicScene', () => ({ default: () => <div data-testid="scene" /> }));
const show = () => render(<MemoryRouter initialEntries={['/missing']}><Routes><Route path="/" element={<h1>Home</h1>} /><Route path="*" element={<NotFound />} /></Routes></MemoryRouter>);
describe('Not-found experience', () => {
  beforeEach(() => { vi.spyOn(window, 'scrollTo').mockImplementation(() => {}); useAuthStore.setState({ isAuthenticated: false, user: null }); });
  it('provides a home destination and an accurate page title', () => {
    show(); expect(document.title).toBe('Page not found | Agentic Converter'); expect(screen.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/');
    expect(screen.getByText('404 / PAGE NOT FOUND')).toBeInTheDocument();
  });
  it('provides the workspace destination to signed-in users', () => {
    useAuthStore.setState({ isAuthenticated: true }); show(); expect(screen.getByRole('link', { name: 'Open your workspace' })).toHaveAttribute('href', '/dashboard');
  });
  it('uses a safe fallback when a missing address is opened directly', () => {
    window.history.replaceState({}, ''); show(); fireEvent.click(screen.getByRole('button', { name: 'Go back' })); expect(screen.getByRole('heading', { name: 'Home' })).toBeInTheDocument();
  });
});
