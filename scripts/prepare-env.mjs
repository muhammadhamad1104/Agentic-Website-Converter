import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { updateEnvironment } from './setup-local-services.mjs';

export function privateSecretUpdates(values, random = () => randomBytes(32).toString('hex')) {
  const updates = {};
  for (const key of ['JWT_SECRET', 'PREVIEW_API_SECRET']) {
    if (!values[key] || values[key].length < 32 || /your-|change.me|super_secret/i.test(values[key])) updates[key] = random();
  }
  return updates;
}

function prepare() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const file = resolve(root, '.env');
  const source = readFileSync(existsSync(file) ? file : resolve(root, '.env.example'), 'utf8');
  const updates = privateSecretUpdates(parseEnv(source));
  writeFileSync(file, updateEnvironment(source, updates), { mode: 0o600 });
  chmodSync(file, 0o600);
  for (const service of ['backend', 'frontend', 'worker']) {
    const local = resolve(root, 'apps', service, '.env');
    if (existsSync(local)) chmodSync(local, 0o600);
  }
  console.log('Private .env prepared. Existing provider credentials were preserved.');
  if (updates.JWT_SECRET) console.log('A new JWT_SECRET was generated. Existing sign-in sessions must log in again.');
  if (updates.PREVIEW_API_SECRET) console.log('A new PREVIEW_API_SECRET was generated. Recreate backend and worker together.');
  console.log('Restart containers to load changes. No credential values were printed.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { prepare(); }
  catch { console.error('Could not prepare .env. Check local file permissions.'); process.exitCode = 1; }
}
