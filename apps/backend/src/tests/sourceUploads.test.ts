import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import sites from '../routes/sites';

jest.mock('axios');
jest.mock('@prisma/client', () => {
  const db = { user: { findUnique: jest.fn() }, site: { create: jest.fn() } };
  return { PrismaClient: jest.fn(() => db) };
});
const db = new PrismaClient() as any;
const app = express();
app.use(express.json());
app.use('/sites', sites);
app.use((error: any, _req: any, res: any, _next: any) => res.status(500).json({ error: error.message }));
process.env.JWT_SECRET = 'upload-test-secret';
const auth = { Authorization: 'Bearer ' + jwt.sign({ userId: 'owner' }, process.env.JWT_SECRET) };
const uploaded = { id: '11111111-1111-4111-8111-111111111111', filename: 'website.zip', pages: 3, assets: 12, bytes: 100 };

beforeEach(() => {
  jest.resetAllMocks();
  process.env.PREVIEW_API_SECRET = 'worker-test-secret';
  db.user.findUnique.mockResolvedValue({ id: 'owner', role: 'OWNER', status: 'ACTIVE', plan: 'STARTER' });
  db.site.create.mockResolvedValue({ id: 'site', sourceType: 'ZIP', sourceUrl: 'website.zip' });
  (axios.post as jest.Mock).mockResolvedValue({ data: uploaded });
  (axios.delete as jest.Mock).mockResolvedValue({ data: { ok: true } });
});

test('requires a signed-in account before accepting a file', async () => {
  expect((await request(app).post('/sites/upload-zip').attach('file', Buffer.from('zip'), 'website.zip')).status).toBe(401);
  expect(axios.post).not.toHaveBeenCalled();
});

test('stores only validated worker upload metadata for the authenticated owner', async () => {
  const response = await request(app).post('/sites/upload-zip').set(auth).attach('file', Buffer.from('zip'), 'website.zip');
  expect(response.status).toBe(201);
  expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/api/sources/zip'), Buffer.from('zip'), expect.objectContaining({
    params: { filename: 'website.zip' }, headers: expect.objectContaining({ 'X-Source-Owner': 'owner', 'X-Preview-Secret': 'worker-test-secret' }),
  }));
  expect(db.site.create).toHaveBeenCalledWith({ data: expect.objectContaining({
    ownerId: 'owner', sourceType: 'ZIP', sourceUrl: 'website.zip', settings: { sourceUpload: uploaded },
  }) });
});

test('rejects non-ZIP selection and malformed form fields before worker transfer', async () => {
  expect((await request(app).post('/sites/upload-zip').set(auth).attach('file', Buffer.from('bad'), 'website.html')).status).toBe(400);
  expect((await request(app).post('/sites/upload-zip').set(auth).field('ownerId', 'another').attach('file', Buffer.from('zip'), 'website.zip')).status).toBe(400);
  expect(axios.post).not.toHaveBeenCalled();
});

test('returns worker archive rejection without creating a project', async () => {
  (axios.isAxiosError as unknown as jest.Mock).mockReturnValue(true);
  (axios.post as jest.Mock).mockRejectedValue({ response: { status: 400, data: { detail: 'ZIP contains server-side files' } } });
  const response = await request(app).post('/sites/upload-zip').set(auth).attach('file', Buffer.from('zip'), 'bad.zip');
  expect(response.status).toBe(400);
  expect(response.body.error).toContain('server-side files');
  expect(db.site.create).not.toHaveBeenCalled();
});

test('cleans up a worker upload if project creation fails', async () => {
  db.site.create.mockRejectedValue(new Error('Database unavailable'));
  expect((await request(app).post('/sites/upload-zip').set(auth).attach('file', Buffer.from('zip'), 'website.zip')).status).toBe(500);
  expect(axios.delete).toHaveBeenCalledWith(expect.stringContaining('/api/sources/zip/' + uploaded.id), expect.objectContaining({
    headers: expect.objectContaining({ 'X-Source-Owner': 'owner' }),
  }));
});
