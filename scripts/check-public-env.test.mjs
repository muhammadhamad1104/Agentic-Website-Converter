import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePublicEnvironment } from './check-public-env.mjs';

const valid = {
  PUBLIC_APP_HOST: 'converter.example.com', TLS_CONTACT_EMAIL: 'owner@example.com',
  DB_PASSWORD: 'test-only-database-credential', JWT_SECRET: 'test-only-jwt-credential-for-environment-check',
  PREVIEW_API_SECRET: 'test-only-preview-credential-for-environment-check', GROQ_API_KEY: 'test-only-provider',
};

test('uses one public frontend/API and a separate same-site preview hostname', () => {
  assert.deepEqual(validatePublicEnvironment(valid), {
    frontend: 'https://converter.example.com', preview: 'https://preview.converter.example.com',
  });
});

test('rejects local, malformed, and configuration-injection hostnames', () => {
  for (const host of ['', 'localhost', 'converter.local', 'converter.test', '127.0.0.1',
    'https://converter.example.com', 'converter.example.com/path', 'x\nmalicious.example.com', '-bad.example.com']) {
    assert.throws(() => validatePublicEnvironment({ ...valid, PUBLIC_APP_HOST: host }), /PUBLIC_APP_HOST/);
  }
});

test('rejects weak, reused, or absent deployment secrets without exposing them', () => {
  for (const key of ['DB_PASSWORD', 'JWT_SECRET', 'PREVIEW_API_SECRET']) {
    assert.throws(() => validatePublicEnvironment({ ...valid, [key]: 'short' }), new RegExp(key));
  }
  assert.throws(() => validatePublicEnvironment({ ...valid, PREVIEW_API_SECRET: valid.JWT_SECRET }), /different/);
  assert.throws(() => validatePublicEnvironment({ ...valid, GROQ_API_KEY: '' }), /provider/);
  assert.throws(() => validatePublicEnvironment({ ...valid, TLS_CONTACT_EMAIL: '' }), /TLS_CONTACT_EMAIL/);
});
