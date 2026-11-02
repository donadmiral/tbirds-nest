const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const compile = file => ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const batchSource = compile('shared/keyedBatchReader.ts'), metadataSource = compile('web/lib/postMetadata.ts');
function fixture() {
  const calls = [], hydration = [], listeners = new Set();
  const rows = { post_collaborators: [], post_media: [], post_media_tags: [], post_polls: [] };
  let session = { revision: 1, scope: 'a:1' }, fail = false, hold = null;
  const client = { from(table) {
    const q = { table, start: 0, end: Infinity, filters: {} };
    const query = {
      select(value) { q.selection = value; return query; },
      in(key, value) { q.filters[key] = value; return query; },
      eq(key, value) { q.filters[key] = value; return query; },
      order() { return query; },
      range(start, end) { q.start = start; q.end = end; return query; },
      abortSignal(signal) { q.signal = signal; return query; },
      then(yes, no) {
        calls.push(q);
        const result = fail ? { data: null, error: { message: 'offline' } } : {
          data: rows[table].filter(row => Object.entries(q.filters).every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : row[key] === value)).slice(q.start, q.end + 1), error: null,
        };
        return (hold ? hold.promise.then(() => result) : Promise.resolve(result)).then(yes, no);
      },
    };
    return query;
  } };
  const batch = {};
  vm.runInNewContext(batchSource, { exports: batch, AbortController, setTimeout, clearTimeout });
  const exports = {};
  vm.runInNewContext(metadataSource, { exports, window: {}, Map, Set, require(name) {
    if (name === '../../shared/keyedBatchReader') return batch;
    if (name === './supabase/client') return { createClient: () => client };
    if (name === './navigationCache') return { getNavigationStore: () => ({ getSnapshot: () => session, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); } }) };
    if (name === './contentMedia') return { hydratePostMedia: async posts => { hydration.push(posts); return posts.map(post => ({ ...post, post_media: post.post_media.map(media => ({ ...media, edit: media.edit ? { ...media.edit, coverUrl: 'authorized:' + media.id } : null })) })); } };
    throw Error(name);
  } });
  return { ...exports, calls, hydration, rows, set fail(value) { fail = value; },
    set hold(value) { hold = value; },
    change(scope) { session = { revision: session.revision + 1, scope }; listeners.forEach(fn => fn()); },
  };
}

test('a feed page batches collaborator, poll, edit and tag reads without mixing posts', async () => {
  const f = fixture();
  const ids = Array.from({ length: 20 }, (_, i) => 'post-' + i);
  ids.forEach((id, i) => {
    f.rows.post_collaborators.push({ post_id: id, user_id: 'user-' + i, status: 'accepted', profile: { full_name: 'Name ' + i } });
    f.rows.post_media.push({ post_id: id, id: 'media-' + i, edit: { trimStart: i, coverUrl: 'private' } });
    f.rows.post_media_tags.push({ media_id: 'media-' + i, user_id: 'tag-' + i, nx: .2, ny: .3 });
    if (i % 2 === 0) f.rows.post_polls.push({ post_id: id });
  });
  const values = await Promise.all(ids.map(async (id, i) => Promise.all([
    f.readPostCollaborators(id), f.readPostPollFlag(id), f.readPostMediaEdits(id, ['media-' + i]), f.readPostMediaTags(['media-' + i]),
  ])));
  assert.equal(f.calls.length, 4, '80 per-card reads become four authorized batch queries');
  assert.equal(f.hydration.length, 1); assert.equal(f.hydration[0].length, 20);
  values.forEach(([people, poll, edits, tags], i) => {
    assert.equal(people[0].user_id, 'user-' + i); assert.equal(poll, i % 2 === 0);
    assert.equal(edits['media-' + i].trimStart, i); assert.equal(edits['media-' + i].coverUrl, 'authorized:media-' + i);
    assert.equal(tags[0].user_id, 'tag-' + i);
  });
  assert.ok(f.calls.every(call => call.signal instanceof AbortSignal));
});

test('large tag results are paged so the last card is not silently truncated', async () => {
  const f = fixture();
  for (let i = 0; i < 501; i++) f.rows.post_media_tags.push({ media_id: 'a', user_id: 'a-' + i });
  for (let i = 0; i < 12; i++) f.rows.post_media_tags.push({ media_id: 'b', user_id: 'b-' + i });
  const result = await f.readPostMediaTags(['a', 'b']);
  assert.equal(result.length, 513); assert.equal(result.filter(row => row.media_id === 'b').length, 12);
  assert.deepEqual(f.calls.map(call => [call.start, call.end]), [[0, 499], [500, 999]]);
});

test('media recipes are accepted only for the requested parent post', async () => {
  const f = fixture();
  f.rows.post_media.push({ id: 'same-media', post_id: 'different-post', edit: { trimStart: 99 } });
  const edits = await f.readPostMediaEdits('intended-post', ['same-media']);
  assert.equal(edits['same-media'], null); assert.equal(f.hydration.length, 0);
});

test('failures remain retryable instead of recording absent polls or people', async () => {
  const f = fixture(); f.rows.post_polls.push({ post_id: 'post' });
  f.fail = true; await assert.rejects(f.readPostPollFlag('post'), /offline/);
  f.fail = false; assert.equal(await f.readPostPollFlag('post'), true);
  assert.equal(f.calls.length, 2);
});

test('switching accounts aborts transport and rejects private results from the old session', async () => {
  const f = fixture(); let resolve;
  f.hold = { promise: new Promise(done => { resolve = done; }) };
  const request = f.readPostCollaborators('post'), check = assert.rejects(request, /session changed/);
  await new Promise(done => setTimeout(done, 25));
  assert.equal(f.calls.length, 1); f.change('b:2'); await check;
  assert.equal(f.calls[0].signal.aborted, true);
  f.hold = null; resolve();
  f.rows.post_collaborators.push({ post_id: 'post', user_id: 'new', status: 'accepted' });
  assert.equal((await f.readPostCollaborators('post'))[0].user_id, 'new');
});
