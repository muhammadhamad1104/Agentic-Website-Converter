import request from 'supertest';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import { Readable } from 'node:stream';
import { createPreviewGateway, previewLink } from '../services/previewGateway';
jest.mock('axios');
const gateway = createPreviewGateway();
beforeEach(() => {
  jest.resetAllMocks();
  process.env.PREVIEW_API_SECRET = 'test-gateway-secret';
  delete process.env.PREVIEW_PUBLIC_URL;
});
test('requires a preview capability on the separate origin', async () => {
  expect((await request(gateway).get('/')).status).toBe(403);
  expect((await request(gateway).get('/__preview/open?token=invalid')).status).toBe(403);
  expect(axios).not.toHaveBeenCalled();
});
test('a preview capability cannot act as an account JWT', () => {
  const url = previewLink({ headers: { origin: 'http://127.0.0.1:5173' } } as any, 'owner', 'lease');
  expect(url.startsWith('http://127.0.0.1:5001/')).toBe(true);
  const payload = jwt.verify(new URL(url).searchParams.get('token')!, process.env.PREVIEW_API_SECRET!) as any;
  expect(payload).toMatchObject({ owner: 'owner', lease: 'lease', aud: 'converter-preview' });
  expect(payload.userId).toBeUndefined();
});
test('requires an explicit public preview origin outside localhost', () => {
  expect(() => previewLink({ headers: { origin: 'https://app.example.com' } } as any, 'owner', 'lease')).toThrow('PREVIEW_PUBLIC_URL');
});
test('sets an HttpOnly cookie and proxies only the scoped session', async () => {
  const link = new URL(previewLink({ headers: { origin: 'http://localhost:5173' } } as any, 'owner', 'lease'));
  const open = await request(gateway).get(link.pathname + link.search);
  expect(open.status).toBe(302);
  expect(open.headers['set-cookie'][0]).toContain('HttpOnly');
  expect(open.headers['set-cookie'][0]).toContain('SameSite=Lax');
  (axios as unknown as jest.Mock).mockResolvedValue({ status: 200, headers: { 'content-type': 'text/html' }, data: Readable.from(['preview page']) });
  const page = await request(gateway).get('/services?view=1').set('Cookie', open.headers['set-cookie']);
  expect(page.text).toContain('preview page');
  expect(page.text).toContain('src="/__preview/navigation.js"');
  expect(axios).toHaveBeenCalledWith(expect.objectContaining({
    url: expect.stringContaining('/api/previews/lease/proxy/services?view=1'),
    headers: expect.objectContaining({ 'X-Preview-Owner': 'owner', 'X-Preview-Secret': 'test-gateway-secret' }),
    maxRedirects: 0,
  }));
  expect((axios as unknown as jest.Mock).mock.calls[0][0].headers.Cookie).not.toContain('converter_preview=');
});
test('does not change the captured website HTML', async () => {
  const link = new URL(previewLink({ headers: { origin: 'http://localhost:5173' } } as any, 'owner', 'lease'));
  const open = await request(gateway).get(link.pathname + link.search);
  const html = '<html><body><h1>Original source</h1></body></html>';
  (axios as unknown as jest.Mock).mockResolvedValue({ status: 200, headers: { 'content-type': 'text/html' }, data: Readable.from([html]) });
  const page = await request(gateway).get('/__site/services?view=1').set('Cookie', open.headers['set-cookie']);
  expect(page.text).toBe(html);
});
test('serves only a static route-observer script without accessing private worker data', async () => {
  const script = await request(gateway).get('/__preview/navigation.js');
  expect(script.status).toBe(200);
  expect(script.headers['content-type']).toContain('application/javascript');
  expect(script.headers['cache-control']).toBe('no-store');
  expect(script.text).toContain('converter:preview-location');
  expect(script.text).not.toContain(process.env.PREVIEW_API_SECRET!);
  expect(axios).not.toHaveBeenCalled();
});
