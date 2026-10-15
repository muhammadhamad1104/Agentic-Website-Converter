import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudEnvironment, cloudSecretUpdates } from './prepare-cloud-env.mjs';

const values = {
  SEED_ADMIN_EMAIL: 'owner@example.com', CLOUD_ADMIN_PASSWORD: 'test-only-cloud-administrator',
  CLOUD_DB_PASSWORD: 'test-only-cloud-database-password',
  CLOUD_JWT_SECRET: 'test-only-cloud-jwt-secret-for-configuration',
  CLOUD_PREVIEW_API_SECRET: 'test-only-cloud-preview-secret-for-configuration',
  JWT_SECRET: 'local-session-must-stay-local', DB_PASSWORD: 'local-database-must-stay-local',
  STRIPE_SECRET_KEY: 'sk_test_fixture', GROQ_API_KEY: 'test-only-provider',
  STRIPE_WEBHOOK_SECRET: 'whsec_local_must_stay_local',
  CLOUD_STRIPE_WEBHOOK_SECRET: 'whsec_cloud_fixture',
  MAILTRAP_API_TOKEN: 'management-token-must-stay-local',
};
const tag = 'sha-' + 'a'.repeat(40);
const publicTag = 'public-' + 'b'.repeat(40);

test('maps separate cloud secrets and exact image tags without exporting local/management credentials', () => {
  const remote = cloudEnvironment(values, 'agenticconverter.tech', tag, tag, publicTag);
  assert.equal(remote.JWT_SECRET, values.CLOUD_JWT_SECRET);
  assert.equal(remote.DB_PASSWORD, values.CLOUD_DB_PASSWORD);
  assert.equal(remote.SEED_ADMIN_PASSWORD, values.CLOUD_ADMIN_PASSWORD);
  assert.equal(remote.CLOUD_FRONTEND_TAG, publicTag);
  assert.equal(remote.PREVIEW_PUBLIC_URL, 'https://preview.agenticconverter.tech');
  assert.equal(remote.MAILTRAP_API_TOKEN, undefined);
  assert.equal(remote.CLOUD_SSH_PRIVATE_KEY_B64, undefined);
  assert.equal(remote.STRIPE_WEBHOOK_SECRET, values.CLOUD_STRIPE_WEBHOOK_SECRET);
  assert.equal(remote.TRUST_PROXY, 'uniquelocal');
  assert.equal(remote.LANGSMITH_TRACING, 'false');
  assert.equal(values.DB_PASSWORD, 'local-database-must-stay-local');
});

test('cloud tracing requires explicit opt-in instead of copying local tracing', () => {
  assert.equal(cloudEnvironment({ ...values, LANGSMITH_TRACING: 'true' }, 'agenticconverter.tech', tag, tag, publicTag).LANGSMITH_TRACING, 'false');
  assert.equal(cloudEnvironment({ ...values, CLOUD_LANGSMITH_TRACING: 'true' }, 'agenticconverter.tech', tag, tag, publicTag).LANGSMITH_TRACING, 'true');
});

test('never uses the local Stripe listener secret when a public webhook is not configured', () => {
  const remote = cloudEnvironment({ ...values, CLOUD_STRIPE_WEBHOOK_SECRET: undefined }, 'agenticconverter.tech', tag, tag, publicTag);
  assert.equal(remote.STRIPE_WEBHOOK_SECRET, '');
});

test('does not silently change existing cloud or local credentials', () => {
  const updates = cloudSecretUpdates(values);
  assert.equal(updates.CLOUD_DB_PASSWORD, undefined);
  assert.equal(updates.CLOUD_JWT_SECRET, undefined);
  assert.equal(updates.CLOUD_ADMIN_PASSWORD, undefined);
  assert.equal(updates.DB_PASSWORD, undefined);
  assert.equal(updates.SEED_ADMIN_PASSWORD, undefined);
});

test('creates missing cloud secrets independently and rejects mutable image tags/live payments', () => {
  let count = 0;
  const updates = cloudSecretUpdates({ SEED_ADMIN_EMAIL: 'owner@example.com' }, () => `test-only-generated-secret-${++count}`);
  assert.equal(new Set(Object.values(updates)).size, 5);
  assert.throws(() => cloudEnvironment(values, 'agenticconverter.tech', 'latest', tag, publicTag), /commit-based/);
  assert.throws(() => cloudEnvironment({ ...values, STRIPE_SECRET_KEY: 'sk_live_fixture' }, 'agenticconverter.tech', tag, tag, publicTag), /test mode/);
});
