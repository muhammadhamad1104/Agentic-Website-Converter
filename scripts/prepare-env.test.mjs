import assert from 'node:assert/strict';
import test from 'node:test';
import { privateSecretUpdates } from './prepare-env.mjs';

test('generates missing private secrets without modifying provider keys', () => {
  const values = { STRIPE_SECRET_KEY: 'sk_test_fixture', OPENAI_API_KEY: 'fixture' };
  const updates = privateSecretUpdates(values, () => 'a'.repeat(64));
  assert.deepEqual(updates, { JWT_SECRET: 'a'.repeat(64), PREVIEW_API_SECRET: 'a'.repeat(64) });
  assert.equal(values.STRIPE_SECRET_KEY, 'sk_test_fixture');
});
test('preserves configured secrets and replaces weak placeholders', () => {
  assert.deepEqual(privateSecretUpdates({ JWT_SECRET: 'a'.repeat(64), PREVIEW_API_SECRET: 'b'.repeat(64) }), {});
  assert.ok(privateSecretUpdates({ JWT_SECRET: 'super_secret_key_change_me_in_production' }).JWT_SECRET);
  assert.ok(privateSecretUpdates({ PREVIEW_API_SECRET: 'short' }).PREVIEW_API_SECRET);
});
