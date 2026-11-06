const test = require('node:test');
const assert = require('node:assert/strict');
const { createClipPollDiagnostic } = require('../../web/tests/browser/live-clip-poll-diagnostic.cjs');

test('clip poll evidence retains observed states and elapsed time without adding transitions for repeated state', () => {
  let time = 1000;
  const diagnostic = createClipPollDiagnostic(() => time);
  const result = { clip: { state: 'queued', moderation_state: 'pending', copyright_state: 'cleared', error: null } };
  assert.equal(diagnostic.observe(result), true);
  time += 3000; diagnostic.observe(result);
  time += 3000; diagnostic.observe({ clip: { ...result.clip, state: 'processing' } });
  time += 3000; diagnostic.observe({ clip: { ...result.clip, state: 'ready', moderation_state: 'approved' } });
  const saved = diagnostic.snapshot();
  assert.equal(saved.polls, 4); assert.equal(saved.transitionCount, 2); assert.equal(saved.truncated, false);
  assert.deepEqual(saved.transitions.map(item => [item.elapsedMs, item.state]), [[0, 'queued'], [6000, 'processing'], [9000, 'ready']]);
  assert.equal(saved.last.moderation, 'approved');
  assert.deepEqual(result, { clip: { state: 'queued', moderation_state: 'pending', copyright_state: 'cleared', error: null } });
});

test('clip poll evidence rejects arbitrary response text and never serializes credentials, identities or manifests', () => {
  const secret = 'https://private.example/_live/bearer-secret/master.m3u8?token=private-token';
  const diagnostic = createClipPollDiagnostic(() => 1);
  const raw = { clip: { state: secret, moderation_state: secret, copyright_state: secret, error: secret,
    id: 'private-identity', title: 'private-title', manifest: { source: secret }, token: secret,
    toJSON() { throw new Error('raw clip must not be serialized'); } },
    sourceUrl: secret, permissions: { token: secret }, toJSON() { throw new Error('raw response must not be serialized'); } };
  assert.equal(diagnostic.observe(raw), true);
  assert.deepEqual(diagnostic.snapshot().last, { elapsedMs: 0, state: 'unknown', moderation: 'unknown', copyright: 'unknown', errorCode: 'unknown' });
  assert.doesNotMatch(JSON.stringify(diagnostic.snapshot()), /private|https|bearer|token|manifest|identity|sourceUrl/);
});

test('only known worker and authority error codes, including exact permanent variants, are retained', () => {
  const diagnostic = createClipPollDiagnostic(() => 1);
  for (const code of ['source_not_ready', 'permanent_recording_timeline_unavailable', 'authority_or_attempts_exhausted', 'authority_revoked']) {
    diagnostic.observe({ clip: { state: 'queued', error: code } });
    assert.equal(diagnostic.snapshot().last.errorCode, code);
  }
  for (const code of ['private_token_value', 'permanent_private_token_value', 'source_not_ready_secret', 'clip_worker_failed '.repeat(1000), {}, ['source_not_ready']]) {
    diagnostic.observe({ clip: { state: 'queued', error: code } });
    assert.equal(diagnostic.snapshot().last.errorCode, 'unknown');
  }
});

test('poll evidence remains bounded while preserving the first observation and latest state', () => {
  let time = 0; const diagnostic = createClipPollDiagnostic(() => time);
  for (let index = 0; index < 1000; index++) {
    time = index * 3000;
    diagnostic.observe({ clip: { state: index % 2 ? 'processing' : 'queued' } });
  }
  const saved = diagnostic.snapshot();
  assert.equal(saved.polls, 128); assert.equal(saved.transitionCount, 128);
  assert.equal(saved.transitions.length, 16); assert.equal(saved.transitions[0].elapsedMs, 0);
  assert.equal(saved.last.state, 'processing'); assert.equal(saved.last.elapsedMs, 300000); assert.equal(saved.truncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(saved)) < 4096);
  saved.transitions[0].state = 'mutated'; saved.last.state = 'mutated';
  assert.equal(diagnostic.snapshot().transitions[0].state, 'queued');
  assert.equal(diagnostic.snapshot().last.state, 'processing');
});

test('unexpected getters or a failed diagnostic clock cannot replace the original polling outcome', () => {
  const diagnostic = createClipPollDiagnostic(() => 1);
  const result = { get clip() { throw new Error('private response detail'); } };
  assert.equal(diagnostic.observe(result), false);
  assert.deepEqual(diagnostic.snapshot(), { polls: 0, transitionCount: 0, truncated: false, transitions: [], last: null });
  const brokenClock = createClipPollDiagnostic(() => { throw new Error('private clock detail'); });
  assert.equal(brokenClock.observe({ clip: { state: 'ready' } }), false);
  assert.equal(brokenClock.snapshot().polls, 0);
});
