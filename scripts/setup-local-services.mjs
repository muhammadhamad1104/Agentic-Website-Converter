import { execFileSync } from 'node:child_process';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

export function validateLocalEnvironment(values) {
  if (values.NODE_ENV === 'production') throw new Error('Local demo setup is not allowed in production.');
  if (!/^sk_test_\S+$/.test(values.STRIPE_SECRET_KEY || '')) throw new Error('Configure a Stripe test secret key first. Live keys are not allowed.');
  if (!/^pk_test_\S+$/.test(values.VITE_STRIPE_PUBLISHABLE_KEY || '')) throw new Error('Configure a Stripe test publishable key first.');
  const origin = new URL(values.FRONTEND_URL || 'http://localhost:5173');
  if (origin.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)
      || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('Local demo setup requires a localhost HTTP frontend origin.');
  }
}

export function updateEnvironment(source, updates) {
  const remaining = new Map(Object.entries(updates));
  const lines = source.split(/\r?\n/).filter(line => {
    const key = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1];
    return !key || !remaining.has(key);
  });
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  for (const [key, value] of remaining) lines.push(`${key}=${JSON.stringify(value)}`);
  return `${lines.join('\n')}\n`;
}

function setup() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const envPath = resolve(root, '.env');
  const source = readFileSync(envPath, 'utf8');
  const values = parseEnv(source);
  validateLocalEnvironment(values);
  const compose = (...args) => execFileSync('docker', ['compose', '--profile', 'demo', ...args], {
    cwd: root, encoding: 'utf8', timeout: 180000,
    // Use the root .env for credentials, not stale shell environment overrides.
    env: { ...process.env, ...values }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  console.log('Preparing local test-payment and email services...');
  compose('config', '--quiet');
  compose('pull', 'stripe-listener', 'mailpit');
  const output = compose('run', '--rm', '--no-deps', 'stripe-listener', 'listen', '--print-secret');
  const secret = output.match(/whsec_[A-Za-z0-9]+/)?.[0];
  if (!secret) throw new Error('Stripe did not return a signing secret. Check test-account connectivity.');
  if (values.STRIPE_WEBHOOK_SECRET && values.STRIPE_WEBHOOK_SECRET !== secret) {
    throw new Error('An existing webhook secret differs. This script will not replace a configured webhook.');
  }
  const useLocalMail = !values.SMTP_HOST || values.SMTP_HOST === 'mailpit';
  const updates = {
    STRIPE_SECRET_KEY: values.STRIPE_SECRET_KEY,
    VITE_STRIPE_PUBLISHABLE_KEY: values.VITE_STRIPE_PUBLISHABLE_KEY,
    STRIPE_WEBHOOK_SECRET: secret,
    FRONTEND_URL: values.FRONTEND_URL || 'http://localhost:5173',
    ...(useLocalMail ? {
      SMTP_HOST: 'mailpit', SMTP_PORT: '1025', SMTP_SECURE: 'false', SMTP_USER: '', SMTP_PASS: '',
      SMTP_FROM: 'noreply@example.com', SMTP_ALLOW_INSECURE_LOCAL: 'true',
    } : {}),
  };
  writeFileSync(envPath, updateEnvironment(source, updates), { mode: 0o600 });
  chmodSync(envPath, 0o600);
  Object.assign(values, updates);
  compose('up', '-d', '--no-deps', '--no-build', '--force-recreate', 'backend', 'stripe-listener', ...(useLocalMail ? ['mailpit'] : []));
  console.log('Stripe test webhooks configured. No live payments or paid upgrades were made.');
  console.log(useLocalMail ? 'Local email inbox: http://localhost:8025 (captures email; does not deliver to Gmail).' : 'Existing SMTP configuration preserved.');
  console.log('Application: http://localhost:5173');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { setup(); }
  catch (error) {
    // Child-process errors can contain provider responses or secrets; do not dump them.
    console.error(error.code || error.status ? 'Local setup failed. Check Docker and test-account connectivity, then retry.' : error.message);
    process.exitCode = 1;
  }
}
