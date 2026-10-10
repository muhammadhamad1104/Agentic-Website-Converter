import express, { Request } from 'express';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import { appendPreviewNavigation, PREVIEW_NAVIGATION_PATH, PREVIEW_NAVIGATION_SCRIPT } from './previewNavigation';

const COOKIE = 'converter_preview';
const audience = 'converter-preview';
export function previewLink(req: Request, owner: string, lease: string) {
  const token = jwt.sign({ owner, lease }, process.env.PREVIEW_API_SECRET!, { audience, expiresIn: '1h' });
  let origin = process.env.PREVIEW_PUBLIC_URL;
  if (!origin) {
    const frontend = new URL(String(req.headers.origin || 'http://localhost'));
    if (!['localhost', '127.0.0.1', '[::1]'].includes(frontend.hostname))
      throw new Error('Set PREVIEW_PUBLIC_URL to the dedicated preview origin for remote deployments');
    origin = frontend.protocol + '//' + frontend.hostname + ':' + (process.env.PREVIEW_PORT || '5001');
  }
  return origin.replace(/\/$/, '') + '/__preview/open?token=' + encodeURIComponent(token);
}

export function createPreviewGateway() {
  const gateway = express();
  gateway.disable('x-powered-by');
  gateway.use((_req, res, next) => { res.set('Referrer-Policy', 'no-referrer'); res.set('Cache-Control', 'no-store'); next(); });
  gateway.get('/__preview/open', (req, res) => {
    try {
      const token = String(req.query.token || '');
      jwt.verify(token, process.env.PREVIEW_API_SECRET!, { audience });
      res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.PREVIEW_PUBLIC_URL?.startsWith('https://') || false, maxAge: 3600000 });
      res.redirect('/');
    } catch { res.status(403).send('Preview link is invalid or expired.'); }
  });
  gateway.get(PREVIEW_NAVIGATION_PATH, (_req, res) => {
    res.type('application/javascript').send(PREVIEW_NAVIGATION_SCRIPT);
  });
  gateway.use(express.raw({ type: () => true, limit: '20mb' }));
  gateway.use(async (req, res) => {
    let session: { owner: string; lease: string };
    try {
      const cookie = String(req.headers.cookie || '').split(';').map(item => item.trim()).find(item => item.startsWith(COOKIE + '='));
      session = jwt.verify(decodeURIComponent(cookie?.slice(COOKIE.length + 1) || ''), process.env.PREVIEW_API_SECRET!, { audience }) as typeof session;
      if (!session.owner || !session.lease) throw new Error('Invalid lease');
    } catch { res.status(403).send('Start a preview from your project workspace.'); return; }
    try {
      const worker = process.env.WORKER_URL || process.env.WORKER_API_URL || 'http://localhost:8000';
      const cookies = String(req.headers.cookie || '').split(';').filter(item => !item.trim().startsWith(COOKIE + '=')).join(';');
      const response = await axios({
        method: req.method, url: worker + '/api/previews/' + session.lease + '/proxy' + req.originalUrl,
        data: req.body, responseType: 'stream', timeout: 30000, maxRedirects: 0, validateStatus: () => true,
        headers: { 'X-Preview-Secret': process.env.PREVIEW_API_SECRET, 'X-Preview-Owner': session.owner,
          'Content-Type': req.headers['content-type'] || 'application/octet-stream',
          Cookie: cookies, Accept: req.headers.accept || '*/*', ...(req.headers.range ? { Range: req.headers.range } : {}) },
      });
      res.status(response.status);
      for (const name of ['content-type', 'content-range', 'accept-ranges', 'location', 'set-cookie'])
        if (response.headers[name]) res.setHeader(name, response.headers[name]);
      if (req.method !== 'HEAD' && !/^\/__site(?:\/|$)/.test(req.path) && String(response.headers['content-type']).toLowerCase().startsWith('text/html') &&
          (response.status >= 400 || response.status >= 200 && response.status < 300 && response.status !== 204)) {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('close', () => response.data.destroy());
        for await (const chunk of response.data) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += buffer.length;
          if (size > 64 * 1024 * 1024) {
            response.data.destroy();
            throw new Error('Preview document is too large');
          }
          chunks.push(buffer);
        }
        res.send(appendPreviewNavigation(Buffer.concat(chunks)));
        return;
      }
      response.data.on('error', () => res.destroy());
      res.on('close', () => response.data.destroy());
      response.data.pipe(res);
    } catch { if (!res.headersSent) res.status(503).send('Preview is no longer running. Start it again from the project workspace.'); }
  });
  return gateway;
}
