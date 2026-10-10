import vm from 'node:vm';
import { appendPreviewNavigation, PREVIEW_NAVIGATION_SCRIPT } from '../services/previewNavigation';

function documentAt(pathname: string) {
  const handlers: Record<string, (event?: any) => void> = {};
  const send = jest.fn();
  const location = { origin: 'http://localhost:5001', pathname, search: '', hash: '' };
  let frame: any = null;
  const window = { location, document: { querySelector: () => frame }, parent: { postMessage: send },
    setInterval: (callback: () => void) => { handlers.poll = callback; },
    addEventListener: (name: string, callback: () => void) => { handlers[name] = callback; } };
  vm.runInNewContext(PREVIEW_NAVIGATION_SCRIPT, { window, location });
  return { handlers, send, location, setFrame: (value: any) => { frame = value; } };
}

test('preserves the original captured HTML bytes while adding the preview-only script', () => {
  const html = Buffer.from('<!doctype html><html><body><script>const source = "&amp;";</script></body></html>');
  const result = appendPreviewNavigation(html);
  expect(result.subarray(0, html.length)).toEqual(html);
  expect(result.toString()).toContain('src="/__preview/navigation.js"');
});
test('reports source routes and responds to hash and client-side history changes', () => {
  const page = documentAt('/__site/about');
  expect(page.send).toHaveBeenLastCalledWith({ type: 'converter:preview-location', path: '/about' }, '*');
  page.location.pathname = '/__site/team'; page.location.hash = '#people'; page.handlers.poll();
  expect(page.send).toHaveBeenLastCalledWith({ type: 'converter:preview-location', path: '/team#people' }, '*');
  page.location.hash = '#contact'; page.handlers.hashchange();
  expect(page.send).toHaveBeenLastCalledWith({ type: 'converter:preview-location', path: '/team#contact' }, '*');
});
test('observes nested source frames without touching their markup or history methods', () => {
  const page = documentAt('/'); page.send.mockClear();
  page.setFrame({ contentWindow: { location: { ...page.location, pathname: '/__site/about', hash: '#people' }, document: { querySelector: () => null } } });
  page.handlers.poll();
  expect(page.send).toHaveBeenCalledWith({ type: 'converter:preview-location', path: '/about#people' }, '*');
  page.send.mockClear(); page.handlers.poll(); expect(page.send).not.toHaveBeenCalled();
  page.setFrame({ contentWindow: { location: { ...page.location, origin: 'https://other.example' } } });
  page.handlers.poll();
  expect(page.send).toHaveBeenLastCalledWith({ type: 'converter:preview-location', path: '/' }, '*');
});
test('never reports bootstrap capability tokens', () => {
  const page = documentAt('/__preview/open');
  page.location.search = '?token=secret'; page.handlers.load();
  expect(page.send).not.toHaveBeenCalled();
});
