import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadEnvironment } from '../src/environment.js';

loadEnvironment(fileURLToPath(new URL('../', import.meta.url)));

const require = createRequire(import.meta.url);
const cli = require.resolve('prisma/build/index.js');
// Prisma 6 can fail to create a fresh SQLite database with logging disabled.
// https://github.com/prisma/prisma/issues/29355
const env = { ...process.env, DATABASE_URL: process.env.DATABASE_URL || 'file:./site.db', RUST_LOG: 'info' };
for (const args of [['generate'], ['db', 'push', '--skip-generate']]) {
  const result = spawnSync(process.execPath, [cli, ...args], { env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
