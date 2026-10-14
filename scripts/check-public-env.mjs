import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function validatePublicEnvironment(values) {
  const host = values.PUBLIC_APP_HOST || '';
  if (host.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)
      || /(?:^|\.)(localhost|local|test|example|invalid)$/.test(host)) {
    throw new Error('Set PUBLIC_APP_HOST to your owned public DNS hostname, without a URL scheme or path.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.TLS_CONTACT_EMAIL || '')) {
    throw new Error('Set TLS_CONTACT_EMAIL for certificate notices.');
  }
  for (const [key, minimum] of [['DB_PASSWORD', 24], ['JWT_SECRET', 32], ['PREVIEW_API_SECRET', 32]]) {
    const value = values[key] || '';
    if (value.length < minimum || /^(?:postgres|password|changeme|replace[-_ ]?me|dev[-_ ]?secret)$/i.test(value)) {
      throw new Error(`Set a unique ${key} of at least ${minimum} characters before first cloud database setup.`);
    }
  }
  if (values.JWT_SECRET === values.PREVIEW_API_SECRET) {
    throw new Error('JWT_SECRET and PREVIEW_API_SECRET must be different.');
  }
  if (!['OPENAI_API_KEY', 'KIMI_API_KEY', 'DEEPSEEK_API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY',
    'OPEN_SOURCE_API_KEY', 'ANTHROPIC_API_KEY'].some(key => values[key])) {
    throw new Error('Configure an LLM provider and verify its quota/billing separately from hosting.');
  }
  return { frontend: `https://${host}`, preview: `https://preview.${host}` };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const origins = validatePublicEnvironment(parseEnv(readFileSync(new URL('../.env', import.meta.url), 'utf8')));
    console.log('PASS: Public hostname and minimum private configuration checks.');
    console.log(`Frontend/API: ${origins.frontend}; generated preview: ${origins.preview}`);
    console.log('No resources created. Verify subscription spending protection, DNS, isolation, backups, and provider billing before deployment.');
  } catch (error) {
    console.error(error.code ? 'Public environment check failed. Configure the private server .env.' : error.message);
    process.exitCode = 1;
  }
}
