const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function load(relative, client, options = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../..', relative), 'utf8');
  const module = { exports: {} };
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, Set, require: (name) => {
    if (name === '@/lib/contentMedia') return {hydratePostMedia: async (rows, actual) => {assert.equal(actual,client); if(options.mediaError)throw new Error('media unavailable');client.hydrated=(client.hydrated||0)+1;return rows;}};
    if (name === '@/lib/supabase/client') return { createClient: () => client };
    throw new Error(`Unexpected dependency ${name}`);
  } });
  return module.exports;
}

function client(options = {}) {
  let sessionReads = 0;
  const queries = [];
  const viewer = options.viewer === undefined ? 'viewer-a' : options.viewer;
  const api = {
    queries,
    auth: { getSession: async () => {
      sessionReads++;
      const id = options.switchViewer && sessionReads > 1 ? 'viewer-b' : viewer;
      return { data: { session: id ? { user: { id } } : null }, error: null };
    } },
    rpc: async () => ({ data: [{ post_id: 'post-a', author_id: 'author-a', likes_count: 4, promo_id: 'promo-a' }], error: null }),
    from(table) {
      const query = { table, filters: {} };
      queries.push(query);
      const builder = {
        select() { return this; },
        eq(key, value) { query.filters[key] = value; return this; },
        in(key, value) { query.filters[key] = value; return this; },
        insert(row) { query.insert = row; return this; },
        delete() { query.delete = true; return this; },
        then(resolve, reject) {
          if (options.throwNetwork) return Promise.reject(new Error('offline')).then(resolve, reject);
          return Promise.resolve({
            data: table === 'follows' ? [{ following_id: 'author-a' }] : [{ post_id: 'post-a' }],
            error: options.errorTable === table ? { code: '503', message: 'unavailable' } : options.writeError ?? null,
          }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
  return api;
}

test('sponsored cards preserve actual viewer interactions and use bounded batched reads', async () => {
  const api = client();
  const rows = await load('web/lib/ads.ts', api).getActivePromos();
  assert.equal(rows.length, 1);
  assert.equal(api.hydrated,1);
  for (const key of ['viewer_liked', 'viewer_reposted', 'viewer_bookmarked', 'viewer_follows']) assert.equal(rows[0][key], true);
  assert.equal(rows[0].likes_count, 4);
  assert.equal(api.queries.length, 4);
  assert.ok(api.queries.every((q) => q.filters.user_id === 'viewer-a' || q.filters.follower_id === 'viewer-a'));
});
test('failed relationship reads never fabricate false interaction state', async () => {
  const rows = await load('web/lib/ads.ts', client({ errorTable: 'post_likes' })).getActivePromos();
  assert.equal(rows.length, 0);
});
test('account changes discard sponsored state from the previous viewer', async () => {
  const rows = await load('web/lib/ads.ts', client({ switchViewer: true })).getActivePromos();
  assert.equal(rows.length, 0);
});
test('signed-out promo reads do not query private viewer relations', async () => {
  const api = client({ viewer: null });
  const rows = await load('web/lib/ads.ts', api).getActivePromos();
  assert.equal(rows[0].viewer_liked, false);
  assert.equal(api.queries.length, 0);
});
test('interaction network exceptions return a failure for optimistic rollback', async () => {
  assert.equal(await load('web/lib/interactions.ts', client({ throwNetwork: true })).toggleLike('post-a', true), false);
});
test('already established likes are idempotent; unrelated failures are not success', async () => {
  assert.equal(await load('web/lib/interactions.ts', client({ writeError: { code: '23505' } })).toggleLike('post-a', true), true);
  assert.equal(await load('web/lib/interactions.ts', client({ writeError: { code: '42501' } })).toggleLike('post-a', true), false);
});
test('unlike is scoped to the current viewer and target post', async () => {
  const api = client();
  assert.equal(await load('web/lib/interactions.ts', api).toggleLike('post-a', false), true);
  assert.equal(api.queries[0].filters.user_id, 'viewer-a');
  assert.equal(api.queries[0].filters.post_id, 'post-a');
  assert.equal(api.queries[0].delete, true);
});
test('a completed write from the previous account is not applied to the new viewer', async () => {
  assert.equal(await load('web/lib/interactions.ts', client({ switchViewer: true })).toggleLike('post-a', true), false);
});
test('a returned auth error cannot authorize an interaction from stale session data', async () => {
  const api = client();
  api.auth.getSession = async () => ({ data: { session: { user: { id: 'stale-user' } } }, error: { message: 'session unavailable' } });
  assert.equal(await load('web/lib/interactions.ts', api).toggleLike('post-a', true), false);
  assert.equal(api.queries.length, 0);
});

test('a failed media authorization never exposes an unhydrated sponsored card', async()=>{const api=client();assert.equal((await load('web/lib/ads.ts',api,{mediaError:true}).getActivePromos()).length,0);});
