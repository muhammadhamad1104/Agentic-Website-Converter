export const PREVIEW_NAVIGATION_PATH = '/__preview/navigation.js';

// Only route information crosses the preview origin; never cookies or capabilities.
export const PREVIEW_NAVIGATION_SCRIPT = `(() => {
  if (window.__converterNavigation) return;
  window.__converterNavigation = true;
  let previous = '';
  const report = () => {
    let active = window;
    for (let depth = 0; depth < 32; depth++) {
      try {
        const frame = active.document.querySelector('iframe.source-site');
        if (!frame?.contentWindow || frame.contentWindow.location.origin !== location.origin) break;
        active = frame.contentWindow;
      } catch { break; }
    }
    const current = active.location;
    if (current.pathname.startsWith('/__preview/')) return;
    const path = (current.pathname.replace(/^\\/__site(?=\\/|$)/, '') || '/') + current.search + current.hash;
    if (path !== previous && window.parent !== window) {
      previous = path;
      window.parent.postMessage({ type: 'converter:preview-location', path }, '*');
    }
  };
  window.addEventListener('popstate', report);
  window.addEventListener('hashchange', report);
  window.addEventListener('load', report);
  window.setInterval(report, 400);
  report();
})();`;

export function appendPreviewNavigation(html: Buffer): Buffer {
  // Preserve captured markup byte-for-byte instead of parsing and reserializing it.
  return Buffer.concat([html, Buffer.from('\n<script defer src="' + PREVIEW_NAVIGATION_PATH + '"></script>')]);
}
