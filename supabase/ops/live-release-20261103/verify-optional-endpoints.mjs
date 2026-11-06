import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { project: { type: 'string' }, output: { type: 'string' } } });
if (!['uaulhuelcfkjwojtymmw', 'prlkikhckbifseosbukl'].includes(values.project)) throw Error('Known project required');
const base = `https://${values.project}.supabase.co/functions/v1/`;
const cases = [];
for (const name of ['live-connect', 'live-social', 'live-social-worker', 'live-transcription-worker', 'live-clip-scaler']) {
  for (const credential of ['missing', 'invalid']) cases.push({ name, path: name, method: 'POST', credential, expected: 401 });
}
cases.push(
  { name: 'live-social-pull', path: 'live-social-pull', method: 'GET', credential: 'missing', expected: 403 },
  { name: 'live-social-pull', path: `live-social-pull/00000000-0000-4000-8000-000000000000/clip.mp4?token=${'0'.repeat(64)}`, method: 'GET', credential: 'synthetic_invalid_capability', expected: 403 },
  { name: 'live-social-pull', path: 'live-social-pull', method: 'POST', credential: 'missing', expected: 405 },
);
const results = await Promise.all(cases.map(async item => {
  const headers = { 'Content-Type': 'application/json' };
  if (item.credential === 'invalid') headers.Authorization = `Bearer ${'invalid-live-acceptance-token-'.repeat(2)}`;
  try {
    const response = await fetch(base + item.path, { method: item.method, headers,
      body: item.method === 'POST' ? '{}' : undefined, redirect: 'manual', signal: AbortSignal.timeout(20000) });
    const cache = response.headers.get('Cache-Control') || '';
    // The receipt records only status/header decisions, never response data or capability URLs.
    await response.body?.cancel();
    return { endpoint: item.name, method: item.method, credential: item.credential,
      status: response.status, expected_status: item.expected, private_no_store: cache.includes('private') && cache.includes('no-store'),
      redirect_absent: !response.headers.has('Location'),
      ok: response.status === item.expected && cache.includes('private') && cache.includes('no-store') && !response.headers.has('Location') };
  } catch { return { endpoint: item.name, method: item.method, credential: item.credential, ok: false, error: 'REQUEST_UNAVAILABLE' }; }
}));
const receipt = { schema_version: 1, checked_at: new Date().toISOString(), project_ref: values.project,
  scope: 'Hosted negative authentication and private response cache checks',
  provider_calls_authorized: false, real_posts_created: false, results,
  passed: results.filter(item => item.ok).length, failed: results.filter(item => !item.ok).length };
if (values.output) await writeFile(values.output, JSON.stringify(receipt, null, 2) + '\n');
process.stdout.write(JSON.stringify(receipt) + '\n');
if (receipt.failed) process.exitCode = 1;
