import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { workerHandler } from '../server.mjs';
const secret = 'synthetic-clip-cron-secret-0123456789';
async function serverFor(options) {
  const server = http.createServer(workerHandler({ secret, ...options })); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}
async function close(server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
test('HTTP admission authenticates before maintenance and bounds concurrent drains', async () => {
  let maintain = 0, drain = 0, release; const entered = new Promise(resolve => { release = resolve; });
  let complete; const hold = new Promise(resolve => { complete = resolve; });
  const { server, origin } = await serverFor({ api: { maintain: async () => { maintain++; release(); await hold; } }, worker: { active: false, drain: async () => { drain++; return { state: 'ready' }; } } });
  try {
    assert.equal((await fetch(origin + '/drain', { method: 'POST' })).status, 401); assert.equal(maintain, 0);
    const init = { method: 'POST', headers: { Authorization: `Bearer ${secret}` } };
    const first = fetch(origin + '/drain', init); await entered;
    const busy = await fetch(origin + '/drain', init); assert.deepEqual(await busy.json(), { state: 'busy' });
    complete(); assert.deepEqual(await (await first).json(), { state: 'ready' }); assert.equal(maintain, 1); assert.equal(drain, 1);
  } finally { complete(); await close(server); }
});
test('malformed HTTP request targets return 400 and do not crash the process', async () => {
  const { server, origin } = await serverFor({ api: {}, worker: { active: false } });
  try {
    const status = await new Promise((resolve, reject) => {
      const request = http.request({ host: '127.0.0.1', port: server.address().port, path: 'http://[', method: 'GET' }, response => { response.resume(); resolve(response.statusCode); });
      request.on('error', reject); request.end();
    });
    assert.equal(status, 400); assert.equal((await fetch(origin + '/health')).status, 200);
  } finally { await close(server); }
});
test('shutdown refuses new jobs and propagates cancellation into an active drain', async () => {
  const stopping = new AbortController(); let started;
  const entered = new Promise(resolve => { started = resolve; });
  const { server, origin } = await serverFor({ stopping, api: { maintain: async () => {} }, worker: { active: false, drain: async signal => {
    started(); await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })); return { state: 'retry', code: 'clip_deadline' };
  } } });
  try {
    const init = { method: 'POST', headers: { Authorization: `Bearer ${secret}` } };
    const first = fetch(origin + '/drain', init); await entered; stopping.abort();
    assert.equal((await first).status, 503);
    const stopped = await fetch(origin + '/drain', init); assert.equal(stopped.status, 503); assert.deepEqual(await stopped.json(), { state: 'stopping' });
    assert.equal((await (await fetch(origin + '/health')).json()).ok, false);
  } finally { stopping.abort(); await close(server); }
});
test('container entrypoint starts with only its documented credentials and shuts down cleanly', async () => {
  const entry = new URL('../server.mjs', import.meta.url).href;
  const code = `import {startWorker} from ${JSON.stringify(entry)};const server=startWorker();server.once('listening',()=>console.log(server.address().port));`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { PATH: process.env.PATH, SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co', LIVE_HLS_CDN_ORIGIN: 'https://live.synthetic.invalid',
      LIVE_CLIP_WORKER_SECRET: 'synthetic-clip-broker-secret-0123456789', LIVE_CLIP_CRON_SECRET: secret, PORT: '0', NODE_ENV: 'production' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = ''; child.stderr.on('data', data => { errors += data; });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
  try {
    const [line] = await Promise.race([once(child.stdout, 'data'), once(child, 'exit').then(() => { throw Error(`startup_failed:${errors}`); })]);
    const port = Number(String(line).trim()); assert.ok(port > 0);
    const health = await fetch(`http://127.0.0.1:${port}/health`); assert.equal(health.status, 200); assert.equal((await health.json()).profile, 'live-clips-v1');
    const exited = once(child, 'exit'); child.kill('SIGTERM'); const [code, signal] = await exited;
    assert.equal(code, 0, errors); assert.equal(signal, null);
  } finally { clearTimeout(timeout); if (child.exitCode === null) child.kill('SIGKILL'); }
});
