const { loadEnvConfig } = require('@next/env');

// Match Next's production .env loading without echoing parser errors or values.
let loadFailed = false;
try {
  loadEnvConfig(process.cwd(), false, { info() {}, error() { loadFailed = true; } });
} catch {
  loadFailed = true;
}
if (loadFailed) {
  console.error('Build configuration: could not load environment files.');
  process.exit(1);
}

const required = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'];
const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length) {
  console.error('Build configuration: missing required environment variables: ' + missing.join(', '));
  process.exit(1);
}

try {
  const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) throw new Error();
} catch {
  console.error('Build configuration: NEXT_PUBLIC_SUPABASE_URL must be an absolute HTTP(S) URL.');
  process.exit(1);
}

// Presence checks do not authenticate keys or establish backend readiness.
console.log('Build configuration: required variables are present.');
