const { readFileSync } = require('node:fs');
const { parseEnv } = require('node:util');

async function run() {
  const values = parseEnv(readFileSync('.env', 'utf8'));
  const email = values.E2E_ACCOUNT_EMAIL || values.SEED_ADMIN_EMAIL;
  const password = values.E2E_ACCOUNT_PASSWORD || values.SEED_ADMIN_PASSWORD;
  if (!email || !password) throw new Error('Set E2E_ACCOUNT_EMAIL and E2E_ACCOUNT_PASSWORD in the root .env.');
  const origin = values.BACKEND_URL || 'http://localhost:5000';
  const api = async (path, body, token) => {
    const response = await fetch(new URL('/api/' + path, origin), {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('API check failed with HTTP ' + response.status + '.');
    return response.json();
  };
  await api('health');
  const account = await api('auth/login', { email, password });
  await api('account/summary', undefined, account.token);
  console.log('PASS: API health, configured account login, and account summary.');
  console.log('This smoke check does not run LLM conversions or create payments.');
}

run().catch(() => {
  console.error('API smoke check failed. Check the root .env credentials and running services.');
  process.exitCode = 1;
});
