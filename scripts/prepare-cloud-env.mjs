import { randomBytes, generateKeyPairSync } from 'node:crypto';
import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { updateEnvironment } from './setup-local-services.mjs';
import { validatePublicEnvironment } from './check-public-env.mjs';

const runtimeKeys = [
  'LLM_REQUEST_TIMEOUT_SECONDS', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'KIMI_API_KEY', 'KIMI_MODEL', 'DEEPSEEK_API_KEY',
  'DEEPSEEK_MODEL', 'GEMINI_API_KEY', 'GEMINI_MODEL', 'GROQ_API_KEY', 'GROQ_MODEL',
  'OPEN_SOURCE_API_KEY', 'OPEN_SOURCE_MODEL', 'OPEN_SOURCE_BASE_URL', 'LANGSMITH_TRACING',
  'LANGSMITH_ENDPOINT', 'LANGSMITH_API_KEY', 'LANGSMITH_PROJECT', 'STRIPE_SECRET_KEY',
  'VITE_STRIPE_PUBLISHABLE_KEY', 'SMTP_HOST', 'SMTP_PORT',
  'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'SUPPORT_EMAIL',
];

export function cloudEnvironment(values, domain, backendTag, workerTag, frontendTag) {
  for (const tag of [backendTag, workerTag, frontendTag]) {
    if (!/^(?:sha|public)-[a-f0-9]{40}$/.test(tag)) throw new Error('Use explicitly published commit-based container tags.');
  }
  const remote = Object.fromEntries(runtimeKeys.filter(key => values[key] !== undefined).map(key => [key, values[key]]));
  Object.assign(remote, {
    LANGSMITH_TRACING: values.CLOUD_LANGSMITH_TRACING || 'false',
    NODE_ENV: 'production', DB_USER: 'postgres', DB_NAME: 'agentic_converter',
    DB_PASSWORD: values.CLOUD_DB_PASSWORD, JWT_SECRET: values.CLOUD_JWT_SECRET,
    PREVIEW_API_SECRET: values.CLOUD_PREVIEW_API_SECRET, PUBLIC_APP_HOST: domain,
    TLS_CONTACT_EMAIL: values.CLOUD_ADMIN_EMAIL || values.SEED_ADMIN_EMAIL,
    FRONTEND_URL: `https://${domain}`, BACKEND_URL: `https://${domain}`,
    PREVIEW_PUBLIC_URL: `https://preview.${domain}`, VITE_API_URL: `https://${domain}`,
    SEED_ADMIN_EMAIL: values.CLOUD_ADMIN_EMAIL || values.SEED_ADMIN_EMAIL,
    SEED_ADMIN_PASSWORD: values.CLOUD_ADMIN_PASSWORD,
    STRIPE_WEBHOOK_SECRET: values.CLOUD_STRIPE_WEBHOOK_SECRET || '',
    SEED_ADMIN_NAME: values.SEED_ADMIN_NAME || 'Administrator',
    SMTP_ALLOW_INSECURE_LOCAL: 'false', TRUST_PROXY: 'uniquelocal',
    CLOUD_BACKEND_TAG: backendTag, CLOUD_WORKER_TAG: workerTag, CLOUD_FRONTEND_TAG: frontendTag,
  });
  validatePublicEnvironment(remote);
  if (!remote.SEED_ADMIN_PASSWORD || remote.SEED_ADMIN_PASSWORD.length < 12) throw new Error('Configure a strong CLOUD_ADMIN_PASSWORD.');
  if (!remote.STRIPE_SECRET_KEY?.startsWith('sk_test_')) throw new Error('The student demonstration deployment requires Stripe test mode.');
  return remote;
}

export function cloudSecretUpdates(values, secret = () => randomBytes(32).toString('hex')) {
  const updates = {};
  for (const key of ['CLOUD_DB_PASSWORD', 'CLOUD_JWT_SECRET', 'CLOUD_PREVIEW_API_SECRET', 'CLOUD_ADMIN_PASSWORD']) {
    if (!values[key]) updates[key] = secret();
  }
  if (!values.CLOUD_ADMIN_EMAIL) updates.CLOUD_ADMIN_EMAIL = values.SEED_ADMIN_EMAIL;
  return updates;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const path = new URL('../.env', import.meta.url);
    const source = readFileSync(path, 'utf8');
    const values = parseEnv(source);
    const updates = cloudSecretUpdates(values);
    if (!values.CLOUD_SSH_PRIVATE_KEY_B64) {
      const pair = generateKeyPairSync('rsa', { modulusLength: 4096 });
      updates.CLOUD_SSH_PRIVATE_KEY_B64 = Buffer.from(pair.privateKey.export({ type: 'pkcs1', format: 'pem' })).toString('base64');
    }
    writeFileSync(path, updateEnvironment(source, updates), { mode: 0o600 });
    chmodSync(path, 0o600);
    console.log('Separate cloud database, session, administrator, and SSH credentials prepared in your private root .env.');
    console.log('Local account passwords and database settings were not changed. No cloud resources created.');
  } catch {
    console.error('Cloud credential preparation failed. Check the private root .env; no credentials are printed.');
    process.exitCode = 1;
  }
}
