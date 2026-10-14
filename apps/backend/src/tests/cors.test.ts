import cors from 'cors';
import express from 'express';
import request from 'supertest';
import { corsOptions } from '../config/cors';

function app(env: NodeJS.ProcessEnv) {
  const server = express();
  server.use(cors(corsOptions(env)));
  server.get('/api/check', (_req, res) => res.json({ ok: true }));
  return server;
}

describe('Deployment CORS', () => {
  const production = { NODE_ENV: 'production', FRONTEND_URL: 'https://converter.example.com' };

  it('allows the configured frontend with credentials', async () => {
    const response = await request(app(production)).get('/api/check').set('Origin', production.FRONTEND_URL);
    expect(response.headers['access-control-allow-origin']).toBe(production.FRONTEND_URL);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it.each(['https://evil.example', 'https://localhost.evil.example', 'http://localhost:5173', 'null'])
    ('does not grant production CORS to %s', async origin => {
      const response = await request(app(production)).get('/api/check').set('Origin', origin);
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });

  it('keeps non-browser webhook and health requests working', async () => {
    expect((await request(app(production)).get('/api/check')).status).toBe(200);
  });

  it('supports an explicit list and does not implicitly allow other origins', async () => {
    const server = app({ ...production, CORS_ORIGIN: 'https://one.example, https://two.example' });
    expect((await request(server).get('/api/check').set('Origin', 'https://two.example'))
      .headers['access-control-allow-origin']).toBe('https://two.example');
    expect((await request(server).get('/api/check').set('Origin', production.FRONTEND_URL))
      .headers['access-control-allow-origin']).toBeUndefined();
  });

  it.each(['http://localhost:5174', 'http://127.0.0.1:5173', 'http://[::1]:5173'])
    ('preserves local development at %s', async origin => {
      expect((await request(app({ NODE_ENV: 'development' })).get('/api/check').set('Origin', origin))
        .headers['access-control-allow-origin']).toBe(origin);
    });

  it.each(['https://localhost.evil.example', 'http://localhost:5173/path', 'malformed'])
    ('does not confuse an untrusted origin with localhost: %s', async origin => {
      expect((await request(app({ NODE_ENV: 'development' })).get('/api/check').set('Origin', origin))
        .headers['access-control-allow-origin']).toBeUndefined();
    });
});
