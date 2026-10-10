import express from 'express';
import request from 'supertest';
import sharp from 'sharp';
import { PrismaClient } from '@prisma/client';
import authRoutes from '../routes/auth';
import { profilePhoto, MAX_PHOTO_BYTES } from '../services/profilePhoto';

jest.mock('../queue/passwordRecoveryQueue', () => ({ enqueueRecovery: jest.fn(), enqueuePasswordChanged: jest.fn() }));
jest.mock('../middleware/rateLimiter', () => ({ rateLimiter: (_req: any, _res: any, next: any) => next(), recoveryRateLimiter: (_req: any, _res: any, next: any) => next() }));
jest.mock('../middleware/auth', () => ({ requireAuth: (req: any, res: any, next: any) => {
  if (req.headers.authorization !== 'Bearer fixture') return res.status(401).json({ error: 'Unauthorized' });
  req.account = { id: 'self' }; req.user = { userId: 'self' }; next();
} }));
jest.mock('@prisma/client', () => {
  const db = { user: { update: jest.fn(), findUnique: jest.fn() } };
  return { PrismaClient: jest.fn(() => db) };
});
const db = new PrismaClient() as any;
const app = express(); app.use(express.json()); app.use('/auth', authRoutes);
let photo: Buffer;
beforeAll(async () => { photo = await sharp({ create: { width: 600, height: 400, channels: 3, background: '#718764' } }).jpeg().withMetadata({ exif: { IFD0: { Artist: 'Private metadata' } } }).toBuffer(); });
beforeEach(() => { jest.clearAllMocks(); db.user.update.mockImplementation(({ data }: any) => Promise.resolve({ id: 'self', name: 'Member', avatarUrl: data.avatarUrl })); });

test('re-encodes uploads at 256px without retaining metadata', async () => {
  const saved = await profilePhoto(photo);
  expect(saved).toMatch(/^data:image\/webp;base64,/);
  const metadata = await sharp(Buffer.from(saved.split(',')[1], 'base64')).metadata();
  expect(metadata.width).toBe(256); expect(metadata.height).toBe(256); expect(metadata.format).toBe('webp');
  expect(metadata.exif).toBeUndefined(); expect(metadata.xmp).toBeUndefined();
});
test('writes only to the authenticated account, ignoring a requested destination', async () => {
  const response = await request(app).put('/auth/avatar?userId=another-account').set('Authorization', 'Bearer fixture').attach('photo', photo, { filename: 'portrait.jpg', contentType: 'image/jpeg' });
  expect(response.status).toBe(200); expect(response.body.user.avatarUrl).toMatch(/^data:image\/webp;base64,/);
  expect(db.user.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'self' }, select: expect.objectContaining({ avatarUrl: true }) }));
});
test('requires authentication before accepting an upload', async () => {
  expect((await request(app).put('/auth/avatar').attach('photo', photo, 'portrait.jpg')).status).toBe(401); expect(db.user.update).not.toHaveBeenCalled();
});
test.each([Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), Buffer.from('Not a photo'), Buffer.from([137,80,78,71,13,10,26,10])])('rejects spoofed or malformed image content', async buffer => {
  const response = await request(app).put('/auth/avatar').set('Authorization', 'Bearer fixture').attach('photo', buffer, { filename: 'photo.png', contentType: 'image/png' });
  expect(response.status).toBe(400); expect(db.user.update).not.toHaveBeenCalled();
});
test('rejects oversized uploads', async () => {
  const response = await request(app).put('/auth/avatar').set('Authorization', 'Bearer fixture').attach('photo', Buffer.alloc(MAX_PHOTO_BYTES + 1), 'oversized.jpg');
  expect(response.status).toBe(413); expect(db.user.update).not.toHaveBeenCalled();
});
test('rejects excessive image dimensions before decoding pixels', async () => {
  const buffer = await sharp({ create: { width: 5000, height: 5000, channels: 3, background: '#718764' } }).png().toBuffer();
  await expect(profilePhoto(buffer)).rejects.toThrow();
});
test('rejects extra multipart fields instead of allowing account edits', async () => {
  expect((await request(app).put('/auth/avatar').set('Authorization', 'Bearer fixture').field('userId', 'someone-else').attach('photo', photo, 'portrait.jpg')).status).toBe(400);
  expect(db.user.update).not.toHaveBeenCalled();
});
test('removes the current account photo', async () => {
  const response = await request(app).delete('/auth/avatar').set('Authorization', 'Bearer fixture');
  expect(response.status).toBe(200); expect(response.body.user.avatarUrl).toBeNull(); expect(db.user.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'self' }, data: { avatarUrl: null } }));
});
test('returns the stored portrait on a new account fetch', async () => {
  db.user.findUnique.mockResolvedValue({ id: 'self', avatarUrl: 'data:image/webp;base64,saved' });
  const response = await request(app).get('/auth/me').set('Authorization', 'Bearer fixture');
  expect(response.body.user.avatarUrl).toBe('data:image/webp;base64,saved'); expect(db.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ select: expect.objectContaining({ avatarUrl: true }) }));
});
