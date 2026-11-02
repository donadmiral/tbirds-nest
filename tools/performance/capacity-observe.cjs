#!/usr/bin/env node
'use strict';
// Read-only operational export. Credentials stay in the process environment.
// Use the provider's native metrics alongside this application queue snapshot.
const fs = require('node:fs');
const output = process.argv.find(arg => arg.startsWith('--out='))?.slice(6);
const minutes = Number(process.argv.find(arg => arg.startsWith('--minutes='))?.slice(10) ?? 60);

async function main() {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) throw new Error('Use --minutes=0..1440');
  const url = new URL(process.env.SUPABASE_URL || '');
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co') || url.pathname !== '/' || url.username || url.password || url.search || url.hash) {
    throw new Error('SUPABASE_URL must be the intended HTTPS Supabase project origin');
  }
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required in the environment');
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  if (!key.startsWith('sb_secret_')) headers.Authorization = 'Bearer ' + key;
  const response = await fetch(new URL('/rest/v1/rpc/capacity_status_v1', url), {
    method: 'POST', headers, body: JSON.stringify({ p_history_minutes: minutes }),
    signal: AbortSignal.timeout(10_000), redirect: 'error',
  });
  if (!response.ok) throw new Error('Operational snapshot returned HTTP ' + response.status);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Operational snapshot had no body');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 4_000_000) {
        await reader.cancel();
        throw new Error('Operational snapshot exceeded the response budget');
      }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const text = Buffer.concat(chunks, size).toString('utf8');
  const data = JSON.parse(text);
  if (data.version !== 1 || !Array.isArray(data.alerts) || !Array.isArray(data.providers)) throw new Error('Unsupported operational snapshot');
  const result = JSON.stringify(data, null, 2) + '\n';
  if (output) fs.writeFileSync(output, result, { flag: 'wx', mode: 0o600 });
  else process.stdout.write(result);
  if (data.sampling_enabled !== true || data.stale !== false || data.alerts.some(a => a.severity === 'critical')) process.exitCode = 2;
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
