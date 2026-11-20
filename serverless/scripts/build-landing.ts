/**
 * Builds the kit page (../landing-page) and copies it into public/kit/, so one
 * Vercel deployment serves:
 *   /       "Talk to Lumina" page (vite build --config web/vite.config.ts, run after this)
 *   /kit/   kit page for developers and buyers
 *   /api/*  serverless functions
 *
 * The landing page uses pnpm; the pinned version from its package.json is run
 * through npx, so nothing has to be installed globally on Vercel.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const landing = fileURLToPath(new URL('../../landing-page/', import.meta.url));
const output = fileURLToPath(new URL('../public/', import.meta.url));

if (!existsSync(landing)) {
  throw new Error(
    'landing-page/ not found. In Vercel, keep "Include files outside the root directory" on.',
  );
}

const pkg = JSON.parse(readFileSync(`${landing}package.json`, 'utf8')) as {
  packageManager?: string;
};
// "pnpm@10.4.1+sha512..." -> "pnpm@10.4.1"
const pnpm = (pkg.packageManager ?? 'pnpm@10').split('+')[0] ?? 'pnpm@10';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const run = (...args: string[]) =>
  execFileSync(npx, ['--yes', pnpm, ...args], {
    cwd: landing,
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      VITE_BASE_PATH: '/kit/',
      VITE_LIVE_DEMO_URL: '/',
    },
  });

run('install', '--frozen-lockfile');
run('build');

rmSync(output, { recursive: true, force: true });
cpSync(`${landing}dist/public/`, `${output}kit/`, { recursive: true });
// Manus editor debug files are not needed in production.
rmSync(`${output}kit/__manus__`, { recursive: true, force: true });
console.log('Kit page copied to public/kit/');
