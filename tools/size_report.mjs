#!/usr/bin/env node
/**
 * Size budget report. Run after `npm run build`.
 *
 * Budgets (from the product spec):
 *   app shell  < 150 KB gzip  — everything the phone downloads before the show file
 *   show.json  < 400 KB gzip  — 10 000 seats, 10 minute show
 *   show.json  <   2 MB gzip  — 50 000 seats, 10 minute show
 */
import { gzipSync } from 'node:zlib';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(root, 'dist');
const publicDir = join(root, 'public');

const SHELL_BUDGET = 150 * 1024;
const SHOW_BUDGET_SMALL = 400 * 1024; // 10 000 seats, 10 minute show
const SHOW_BUDGET_LARGE = 2 * 1024 * 1024; // 50 000 seats, 10 minute show

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function gzipSize(path) {
  return gzipSync(readFileSync(path), { level: 9 }).length;
}

function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

let failed = false;

console.log('Rayati size report\n');

const shellFiles = walk(distDir).filter((file) => !file.endsWith('.map'));
const showPath = join(publicDir, 'show.json');
const seatsPath = join(publicDir, 'seats.json');

// Mobile app shell downloaded by fans on first load (excluding desktop simulation & guide illustrations)
const isMainShell = (file) => {
  if (file.endsWith('.json')) return false;
  if (file.includes('simulation') || file.includes('guide') || file.includes('images') || file.includes('control') || file.includes('three')) return false;
  return true;
};
const shell = shellFiles.filter(isMainShell);
let shellTotal = 0;
for (const file of shellFiles.filter((f) => !f.endsWith('.json'))) {
  const raw = statSync(file).size;
  const gz = gzipSize(file);
  const inShell = isMainShell(file);
  if (inShell) shellTotal += gz;
  console.log(`  ${relative(root, file).padEnd(46)} ${kb(raw).padStart(10)} raw  ${kb(gz).padStart(10)} gzip ${inShell ? '(shell)' : ''}`);
}
console.log(`\n  mobile app shell (gzip total)${' '.repeat(13)} ${kb(shellTotal).padStart(10)} / budget ${kb(SHELL_BUDGET)}`);
if (shellTotal > SHELL_BUDGET) {
  console.error(`  ✗ mobile app shell exceeds the 150 KB gzip budget`);
  failed = true;
}

if (existsSync(showPath)) {
  const showRaw = statSync(showPath).size;
  const showGz = gzipSize(showPath);
  const seats = JSON.parse(readFileSync(seatsPath, 'utf8')).stadium?.capacity ?? 0;
  const budget = seats > 10000 ? SHOW_BUDGET_LARGE : SHOW_BUDGET_SMALL;
  const label = seats > 10000 ? '<2 MB (50k seats)' : '<400 KB (10k seats)';
  console.log(`\n  show.json (${seats} seats)${' '.repeat(Math.max(0, 22 - String(seats).length))} ${kb(showRaw).padStart(10)} raw  ${kb(showGz).padStart(10)} gzip  budget ${label}`);
  if (showGz > budget) {
    console.error(`  ✗ show.json exceeds its budget (${label})`);
    failed = true;
  }
  const meta = JSON.parse(readFileSync(showPath, 'utf8')).meta;
  console.log(`  ${meta.seatCount} indexed seats · ${meta.durationMs / 60000} min · ${meta.tickMs} ms tick`);
} else {
  console.log('\n  show.json missing — run: npm run show');
}

if (!existsSync(distDir)) {
  console.error('\n  dist/ missing — run: npm run build');
  failed = true;
}

console.log(failed ? '\nsize check FAILED' : '\nsize check OK');
process.exit(failed ? 1 : 0);
