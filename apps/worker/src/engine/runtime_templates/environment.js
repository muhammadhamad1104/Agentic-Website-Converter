import { config } from 'dotenv';
import { openSync, closeSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function loadEnvironment(root) {
  const path = resolve(root, '.env');
  let descriptor;
  try {
    descriptor = openSync(path, 'wx', 0o600);
    writeFileSync(descriptor, readFileSync(resolve(root, '.env.example')));
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  // Deployment environment variables take precedence over the local file.
  config({ path });
}
