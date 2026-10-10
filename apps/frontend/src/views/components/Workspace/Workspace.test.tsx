import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Workspace } from './Workspace';
import { useAuthStore } from '../../../store/authStore';

describe('Workspace navigation', () => {
  beforeEach(() => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    useAuthStore.setState({ user: { id: 'fixture', name: 'Member', email: 'member@example.com', role: 'OWNER', plan: 'STARTER', status: 'ACTIVE', mfaEnabled: false, lastLogin: null, createdAt: '', updatedAt: '' } });
  });
  const show = () => render(<MemoryRouter initialEntries={['/dashboard']}><Workspace><h1>Projects</h1></Workspace></MemoryRouter>);
  it('marks the current destination and keeps administration out of member navigation', () => {
    show(); expect(screen.getByRole('link', { name: 'Projects' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('link', { name: 'Administration' })).not.toBeInTheDocument();
    expect(screen.getByText('Starter membership')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Membership' })).toHaveLength(1);
    expect(screen.queryByRole('link', { name: 'Explore Pro' })).not.toBeInTheDocument();
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument();
    expect(screen.queryByText('Static origins.')).not.toBeInTheDocument();
  });
  it('shows unlimited account navigation without an upgrade prompt', () => {
    useAuthStore.setState({ user: { ...useAuthStore.getState().user!, role: 'ADMIN' } });
    show(); expect(screen.getByRole('link', { name: 'Administration' })).toBeInTheDocument();
    expect(screen.queryByText('Explore Pro')).not.toBeInTheDocument();
  });
  it('keeps Projects selected while a converted application is open', () => {
    render(<MemoryRouter initialEntries={['/sites/project']}><Workspace><h1>Project</h1></Workspace></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Projects' })).toHaveClass('active');
  });
  it('keeps the conversion studio in Projects and provides a focusable skip link', () => {
    render(<MemoryRouter initialEntries={['/wizard']}><Workspace><h1>Conversion studio</h1></Workspace></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Projects' })).toHaveClass('active');
    const skip = screen.getByRole('link', { name: 'Skip to content' });
    expect(skip).toHaveAttribute('href', '#workspace-content');
    skip.focus();
    expect(skip).toHaveFocus();
  });
  it('opens an accessible mobile menu and closes it after navigation', async () => {
    show(); fireEvent.click(screen.getByRole('button', { name: 'Open workspace menu' }));
    const dialog = screen.getByRole('dialog', { name: 'Workspace menu' });
    fireEvent.click(within(dialog).getByRole('link', { name: 'My account' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
