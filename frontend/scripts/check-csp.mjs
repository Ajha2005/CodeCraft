// Runs before every `npm run build` (npm's "prebuild" hook).
//
// vercel.json carries the Content-Security-Policy, and its connect-src must name the
// backend the app is built to talk to, otherwise the browser blocks every API call
// and the deployed site is just a spinner. The policy ships with the placeholder
// api.example.com; this check turns "forgot to change it" into a failed build with
// the fix spelled out, instead of a broken site.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const apiBase = process.env.VITE_API_BASE;
const onVercel = Boolean(process.env.VERCEL);

if (!apiBase) {
  if (onVercel) {
    console.error('check-csp: VITE_API_BASE is not set for this Vercel build, so the site would call http://localhost:3000.');
    console.error('Set VITE_API_BASE to the backend URL (https://api.yourdomain.com) in the Vercel project settings.');
    process.exit(1);
  }
  console.log('check-csp: VITE_API_BASE is not set (local build), skipping.');
  process.exit(0);
}

let origin;
try {
  origin = new URL(apiBase).origin;
} catch {
  console.error(`check-csp: VITE_API_BASE is not a URL: ${apiBase}`);
  process.exit(1);
}

const host = new URL(origin).hostname;
if (!onVercel && (host === 'localhost' || host === '127.0.0.1' || host === '[::1]')) {
  console.log('check-csp: building against a local backend, skipping.');
  process.exit(0);
}

const config = JSON.parse(readFileSync(fileURLToPath(new URL('../vercel.json', import.meta.url)), 'utf8'));
const policy = (config.headers ?? [])
  .flatMap((entry) => entry.headers ?? [])
  .find((header) => header.key.toLowerCase() === 'content-security-policy')?.value;

if (!policy) {
  console.error('check-csp: vercel.json has no Content-Security-Policy header.');
  process.exit(1);
}

const connect = (policy.split(';').map((part) => part.trim()).find((part) => part.startsWith('connect-src')) ?? '').split(/\s+/).slice(1);
const socketOrigin = origin.replace(/^http/, 'ws'); // https -> wss, http -> ws
const missing = [origin, socketOrigin].filter((wanted) => !connect.includes(wanted));

if (missing.length > 0) {
  console.error(`check-csp: the Content-Security-Policy in vercel.json does not allow the backend ${origin}.`);
  console.error(`  connect-src is:  ${connect.join(' ') || '(missing)'}`);
  console.error(`  it must include: ${missing.join(' ')}`);
  console.error('Edit the connect-src entry in frontend/vercel.json (replace https://api.example.com and wss://api.example.com).');
  process.exit(1);
}

console.log(`check-csp: connect-src allows ${origin} and ${socketOrigin}.`);
