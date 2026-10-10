import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PreviewBrowser, { previewRoute } from './PreviewBrowser';

const origin = 'http://localhost:5001';
const source = 'https://www.nowwadvisory.co.nz';
const bootstrap = origin + '/__preview/open?token=private-capability';
const show = () => render(<PreviewBrowser url={bootstrap} sourceUrl={source} title="Converted preview" />);
const frame = () => screen.getByTitle('Converted preview') as HTMLIFrameElement;
const visit = (value: string) => {
  fireEvent.change(screen.getByLabelText('Preview address'), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Go to address' }));
};
const report = (path: string, overrides: Partial<MessageEventInit> = {}) => act(() => {
  window.dispatchEvent(new MessageEvent('message', { origin, source: frame().contentWindow,
    data: { type: 'converter:preview-location', path }, ...overrides }));
});

describe('Preview route parsing', () => {
  it.each(['/admin', 'admin', origin + '/admin', 'localhost:5001/admin', source + '/admin', 'www.nowwadvisory.co.nz/admin'])('maps %s to the generated admin route', value => {
    expect(previewRoute(value, origin, source)).toBe('/admin');
  });
  it('retains query parameters and fragments without exposing the source iframe prefix', () => {
    expect(previewRoute('/__site/about?category=team#people', origin, source)).toBe('/about?category=team#people');
  });
  it.each(['javascript:alert(1)', 'data:text/html,hello', 'https://other.example/admin', '//other.example/admin', '/__preview/open?token=secret', 'http://user:password@localhost:5001/admin'])('rejects unsafe or reserved navigation: %s', value => {
    expect(() => previewRoute(value, origin, source)).toThrow();
  });
});

describe('Preview browser', () => {
  it('bootstraps the private session without putting its capability in the address bar', () => {
    show();
    expect(frame()).toHaveAttribute('src', bootstrap);
    expect(screen.getByLabelText('Preview address')).toHaveValue(origin + '/');
    expect(screen.queryByRole('link', { name: /admin/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /admin/i })).not.toBeInTheDocument();
  });
  it('navigates to admin through the address bar and preserves back/forward history', () => {
    show(); visit('/admin');
    expect(frame()).toHaveAttribute('src', origin + '/admin');
    fireEvent.click(screen.getByRole('button', { name: 'Back in preview' }));
    expect(frame()).toHaveAttribute('src', origin + '/');
    fireEvent.click(screen.getByRole('button', { name: 'Forward in preview' }));
    expect(frame()).toHaveAttribute('src', origin + '/admin');
  });
  it('updates the current address and new-tab link from trusted iframe navigation', () => {
    show(); report('/__site/about?view=team#people');
    expect(screen.getByLabelText('Preview address')).toHaveValue(origin + '/about?view=team#people');
    expect(screen.getByRole('link', { name: 'Open preview in a new tab' })).toHaveAttribute('href', origin + '/about?view=team#people');
    fireEvent.click(screen.getByRole('button', { name: 'Back in preview' }));
    expect(frame()).toHaveAttribute('src', origin + '/');
  });
  it('rejects messages from other windows and origins and cannot navigate outside the generated app', () => {
    show(); report('/admin', { source: window }); report('/admin', { origin: 'https://other.example' });
    report('//other.example/admin'); report('/__preview/open?token=secret');
    expect(screen.getByLabelText('Preview address')).toHaveValue(origin + '/');
    visit('https://other.example/admin');
    expect(frame()).toHaveAttribute('src', bootstrap);
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a path or a URL from this website.');
  });
  it('keeps an in-progress address edit while links report new locations', () => {
    show(); fireEvent.focus(screen.getByLabelText('Preview address'));
    fireEvent.change(screen.getByLabelText('Preview address'), { target: { value: '/admin' } }); report('/about');
    expect(screen.getByLabelText('Preview address')).toHaveValue('/admin');
    fireEvent.click(screen.getByRole('button', { name: 'Go to address' }));
    expect(frame()).toHaveAttribute('src', origin + '/admin');
  });
  it('reloads the current reported route and returns home without adding admin shortcuts', () => {
    show(); report('/about'); const previous = frame();
    fireEvent.click(screen.getByRole('button', { name: 'Reload preview' }));
    expect(frame()).not.toBe(previous); expect(frame()).toHaveAttribute('src', origin + '/about');
    fireEvent.click(screen.getByRole('button', { name: 'Preview home' }));
    expect(frame()).toHaveAttribute('src', origin + '/');
  });
});
