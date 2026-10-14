import assert from 'node:assert/strict';
import test from 'node:test';
import { parseEnv } from 'node:util';
import { updateEnvironment, validateLocalEnvironment } from './setup-local-services.mjs';

const demo = { STRIPE_SECRET_KEY: 'sk_test_fixture', VITE_STRIPE_PUBLISHABLE_KEY: 'pk_test_fixture' };

test('accepts test keys and a localhost origin', () => {
  assert.doesNotThrow(() => validateLocalEnvironment(demo));
  assert.doesNotThrow(() => validateLocalEnvironment({ ...demo, FRONTEND_URL: 'http://127.0.0.1:5173' }));
});

test('rejects production, live keys, and non-local origins', () => {
  for (const overrides of [
    { NODE_ENV: 'production' }, { STRIPE_SECRET_KEY: 'sk_live_fixture' },
    { VITE_STRIPE_PUBLISHABLE_KEY: 'pk_live_fixture' }, { STRIPE_SECRET_KEY: '' },
    { FRONTEND_URL: 'http://example.com' }, { FRONTEND_URL: 'http://localhost:5173/reset-password' },
    { FRONTEND_URL: 'http://name@localhost:5173' }, { FRONTEND_URL: 'http://localhost:5173/#token' },
  ]) assert.throws(() => validateLocalEnvironment({ ...demo, ...overrides }));
});

test('replaces duplicate target keys without altering unrelated configuration', () => {
  const source = '# Demo\r\nSTRIPE_SECRET_KEY=old\r\nexport STRIPE_SECRET_KEY=duplicate\r\nOTHER="keep # this"\r\n';
  const updated = updateEnvironment(source, { STRIPE_SECRET_KEY: 'sk_test_fixture', SMTP_USER: '' });
  assert.equal(updated.match(/STRIPE_SECRET_KEY=/g).length, 1);
  assert.ok(updated.includes('OTHER="keep # this"'));
  assert.deepEqual(parseEnv(updated), { STRIPE_SECRET_KEY: 'sk_test_fixture', SMTP_USER: '', OTHER: 'keep # this' });
  assert.equal(updateEnvironment(updated, { STRIPE_SECRET_KEY: 'sk_test_fixture', SMTP_USER: '' }), updated);
});
