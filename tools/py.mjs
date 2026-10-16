#!/usr/bin/env node
/**
 * Runs one of the Python tools with the project virtualenv when it exists,
 * so `npm run seats` / `npm run show` work on Windows, macOS and Linux.
 *
 *   node tools/py.mjs tools/build_show.py --out public/show.json
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const candidates =
  process.platform === 'win32'
    ? [join(root, '.venv', 'Scripts', 'python.exe'), 'python', 'py']
    : [join(root, '.venv', 'bin', 'python'), 'python3', 'python'];

const python = candidates.find(
  (candidate) => !candidate.includes('python.exe') || existsSync(candidate),
);

if (!python) {
  console.error('No Python interpreter found. Create .venv and install tools/requirements.txt.');
  process.exit(1);
}

const result = spawnSync(python, process.argv.slice(2), { stdio: 'inherit', cwd: root });
if (result.error) {
  console.error(`failed to run ${python}: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
