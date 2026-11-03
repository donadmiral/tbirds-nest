import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, rm, readdir, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createClipWorker, validateClipJob } from '../worker.mjs';
const id = n => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
const job = { id: id(1), lease_id: id(2), clip_id: id(3), session_id: id(4), owner_id: id(5), start_ms: 1000, end_ms: 2000,
  source_path: `live/${id(4)}/${id(6)}/master.m3u8`,
  output_prefix: `${id(5)}/${id(4)}/${id(3)}/${id(2)}/`, formats: ['horizontal'], watermark: true, cover_ms: 0 };
function harness(extra = {}) {
  const calls = []; let unblock;
  const api = {
    claim: async () => { calls.push('claim'); return job; }, source: async () => { calls.push('source'); return 'https://synthetic.invalid/live/master.m3u8'; },
    check: async () => { calls.push('check'); return !extra.revoked; },
    upload: async () => { calls.push('upload'); }, complete: async () => { calls.push('complete'); return !extra.rejectFinish; },
    fail: async (_, error) => { calls.push(['fail', error]); },
  };
  const worker = createClipWorker(api, { maxBytes: 1,
    materialize: async () => ({ filename: '/synthetic/source', seekSeconds: 0, durationSeconds: 1 }),
    encode: async (_, directory) => {
      calls.push('encode'); if (extra.hold) await new Promise(resolve => { unblock = resolve; });
      await mkdir(directory); await writeFile(path.join(directory, 'horizontal.mp4'), 'synthetic');
      return { assets: [{ name: 'horizontal.mp4', bytes: 9 }] };
    },
  });
  return { worker, calls, release: () => unblock() };
}
test('clip publication occurs only after authority recheck and completed uploads', async () => {
  const h = harness(); assert.equal((await h.worker.drain()).state, 'ready');
  assert.deepEqual(h.calls, ['claim', 'source', 'encode', 'check', 'upload', 'complete']); assert.equal(h.worker.active, false);
});
test('revocation during encoding prevents upload and records a bounded retry', async () => {
  const h = harness({ revoked: true }); assert.equal((await h.worker.drain()).state, 'retry');
  assert.ok(!h.calls.includes('upload')); assert.equal(h.calls.at(-1)[1].code, 'clip_lease_or_authority_lost');
});
test('lost completion lease never reports ready', async () => {
  const h = harness({ rejectFinish: true }); assert.equal((await h.worker.drain()).state, 'retry');
  assert.equal(h.calls.at(-1)[1].code, 'clip_publication_rejected');
});
test('a warm worker admits only one concurrent job', async () => {
  const h = harness({ hold: true }); const first = h.worker.drain();
  while (!h.calls.includes('encode')) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await h.worker.drain()).state, 'busy'); h.release(); assert.equal((await first).state, 'ready');
  assert.equal(h.calls.filter(x => x === 'claim').length, 1);
});
test('job object paths and clip duration are scoped before network access', () => {
  assert.throws(() => validateClipJob({ ...job, output_prefix: '../other/' }), /invalid/);
  assert.throws(() => validateClipJob({ ...job, end_ms: 700000 }), /invalid/);
  assert.throws(() => validateClipJob({ ...job, source_path: `live/${id(7)}/${id(6)}/master.m3u8` }), /invalid/);
});
test('deadline cancels execution, records the real queue result, and removes scratch files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pc-clip-deadline-')); let failure;
  try {
    const worker = createClipWorker({ claim: async () => job, source: async () => 'synthetic', fail: async (_, result) => { failure = result; return { ok: true, state: 'queued' }; } }, {
      deadlineMs: 20, maxBytes: 1, tempRoot: root,
      materialize: async (_, directory, { signal }) => {
        await mkdir(directory); await writeFile(path.join(directory, 'partial.ts'), 'partial');
        await new Promise((resolve, reject) => {
          const keepAlive = setTimeout(resolve, 2000);
          const abort = () => { clearTimeout(keepAlive); reject(Error('cancelled')); };
          signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
        });
      },
    });
    assert.deepEqual(await worker.drain(), { state: 'retry', code: 'clip_deadline' });
    assert.equal(failure.code, 'clip_deadline'); assert.equal(worker.active, false);
    assert.deepEqual(await readdir(root), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('scratch cleanup failure cannot permanently lock a warm worker', async () => {
  let directory, claimed = false;
  const worker = createClipWorker({ claim: async () => { if (claimed) return null; claimed = true; return job; }, source: async () => { throw Error('synthetic_failure'); }, fail: async () => ({ ok: true, state: 'queued' }) }, {
    maxBytes: 1, removeDirectory: async value => { directory = value; throw Error('synthetic_cleanup_failure'); },
  });
  try {
    await assert.rejects(worker.drain(), /synthetic_cleanup_failure/);
    assert.equal(worker.active, false); assert.deepEqual(await worker.drain(), { state: 'idle' });
  } finally { if (directory) await rm(directory, { recursive: true, force: true }); }
});
test('encoder classification never claims terminal failure until the database confirms it', async () => {
  for (const queueState of ['queued', 'failed', 'ready']) {
    const worker = createClipWorker({ claim: async () => job, source: async () => { throw Object.assign(Error('unsupported_playlist'), { permanent: true }); }, fail: async () => ({ ok: true, state: queueState }) }, { maxBytes: 1 });
    assert.equal((await worker.drain()).state, queueState === 'queued' ? 'retry' : queueState);
  }
});
