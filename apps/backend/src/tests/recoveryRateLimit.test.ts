import express from 'express';
import request from 'supertest';
import { recoveryRateLimiter } from '../middleware/rateLimiter';

test('limits password-recovery attempts to five per fifteen minutes', async () => {
  const app = express(); app.post('/recovery', recoveryRateLimiter, (_req, res) => res.json({ ok: true }));
  for (let attempt = 0; attempt < 5; attempt++) expect((await request(app).post('/recovery')).status).toBe(200);
  const blocked = await request(app).post('/recovery');
  expect(blocked.status).toBe(429); expect(blocked.body.error).toContain('15 minutes');
});
