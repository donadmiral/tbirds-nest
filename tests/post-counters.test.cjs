const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
const moduleUnderTest = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname, '../shared/postCounters.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { module: moduleUnderTest, exports: moduleUnderTest.exports });
const { readPostCounters, recordPostShare } = moduleUnderTest.exports;
const row = { post_id: 'one', likes_count: 10, comments_count: 4, reposts_count: 6, bookmarks_count: 7, views_count: 8, shares_count: 2, quotes_count: 3 };
const eventId = '20000000-0000-4000-8000-000000000001';
test('share requests retain their event identifier and accept only confirmed scalar counts', async () => {
  const calls = [], client = { rpc: async (name, args) => { calls.push({ name, args }); return { data: 3, error: null }; } };
  assert.equal(await recordPostShare(client, 'one', eventId), 3);
  assert.equal(await recordPostShare(client, 'one', eventId), 3);
  assert.equal(calls[0].name, 'record_post_share_v1');
  assert.equal(calls[0].args.p_event_id, eventId); assert.equal(calls[1].args.p_event_id, eventId);
  for (const data of [null, '3', -1, 2.5]) await assert.rejects(recordPostShare({ rpc: async () => ({ data, error: null }) }, 'one', eventId), /could not be confirmed/);
});
test('a failed share does not silently retry a non-idempotent legacy write', async () => {
  for (const code of ['42501', 'offline']) {
    const calls = [];
    await assert.rejects(recordPostShare({ rpc: async name => { calls.push(name); return { data: null, error: { code } }; } }, 'one', eventId), /could not be confirmed/);
    assert.equal(calls.length, 1);
  }
  const calls = [];
  assert.equal(await recordPostShare({ rpc: async name => { calls.push(name); return { data: null, error: calls.length === 1 ? { code: 'PGRST202' } : null }; } }, 'one', eventId), null);
  assert.deepEqual(calls, ['record_post_share_v1', 'increment_share_count']);
});
test('exact counts use one deduplicated authorized read and omit revoked posts without scans', async () => {
  const calls = [], client = { rpc: async (name, args) => { calls.push({ name, args }); return { data: [row], error: null }; } };
  const result = await readPostCounters(client, ['one', 'one', 'revoked'], async () => { throw Error('legacy scan'); });
  assert.equal(result[0], row); assert.equal(calls.length, 1); assert.equal(calls[0].name, 'get_post_engagement_counts_v1');
  assert.deepEqual(Array.from(calls[0].args.p_ids), ['one', 'revoked']);
});
test('only an absent server reader can use the pre-cutover legacy path', async () => {
  for (const code of ['PGRST202', '42883']) assert.equal((await readPostCounters({ rpc: async () => ({ data: null, error: { code } }) }, ['one'], async () => [row]))[0], row);
  for (const code of ['42501', 'offline']) await assert.rejects(readPostCounters({ rpc: async () => ({ data: null, error: { code } }) }, ['one'], async () => { throw Error('unsafe fallback'); }), /could not be checked/);
});
test('malformed, foreign and duplicate counter rows cannot replace displayed exact values', async () => {
  for (const data of [[{ ...row, likes_count: -1 }], [{ ...row, quotes_count: '3' }], [{ ...row, post_id: 'another' }], [row, row], null]) {
    await assert.rejects(readPostCounters({ rpc: async () => ({ data, error: null }) }, ['one'], async () => []), /could not be checked/);
  }
});
test('empty counters make no request and oversized requests fail before transport', async () => {
  const client = { rpc: async () => { throw Error('unexpected transport'); } };
  assert.equal((await readPostCounters(client, [], async () => [])).length, 0);
  await assert.rejects(readPostCounters(client, Array.from({ length: 101 }, (_, n) => String(n)), async () => []), /100 posts/);
});
