import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const builder = 'agentic-converter-build';
const services = process.argv.slice(2);
try {
  if (services.some(service => !['backend', 'frontend', 'worker'].includes(service))) {
    throw new Error('Specify backend, frontend, or worker only.');
  }
  const docker = (...args) => execFileSync('docker', args, { cwd: root, stdio: 'inherit' });
  try { execFileSync('docker', ['buildx', 'inspect', builder], { stdio: 'ignore' }); }
  catch {
    docker('buildx', 'create', '--name', builder, '--driver', 'docker-container',
      '--driver-opt', 'default-load=true', '--buildkitd-config', resolve(root, 'scripts/buildkitd.toml'));
  }
  docker('buildx', 'inspect', '--bootstrap', builder);
  const envFile = resolve(root, '.env');
  const values = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {};
  const nameservers = [values.APP_DNS_PRIMARY || '1.1.1.1', values.APP_DNS_SECONDARY || '8.8.8.8'];
  if (nameservers.some(address => !isIP(address))) throw new Error('Build DNS must use IP addresses.');
  // Registry requests use daemon DNS, independently of build-step DNS in the TOML.
  execFileSync('docker', ['exec', '-i', `buildx_buildkit_${builder}0`, 'tee', '/etc/resolv.conf'], {
    input: nameservers.map(address => `nameserver ${address}`).join('\n') + '\n',
    stdio: ['pipe', 'ignore', 'inherit'],
  });
  docker('compose', 'build', '--builder', builder, ...(services.length ? services : ['backend', 'frontend', 'worker']));
  console.log('Images rebuilt. Use docker compose up -d --no-build to load them.');
} catch {
  console.error('Project build failed. Check Docker, network access, and the selected service names.');
  process.exitCode = 1;
}
