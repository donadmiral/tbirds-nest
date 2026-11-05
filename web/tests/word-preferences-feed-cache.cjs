const { test } = require('node:test');
const assert = require('node:assert/strict');
const { accountHarness } = require('./helpers/account-component-harness.cjs');

async function preferences(field, write) {
  const h = accountHarness();
  const { createNavigationCache } = h.load('../shared/navigationCache.ts');
  const cache = createNavigationCache();
  const scope = 'account-a:session-1';
  cache.setScope(scope);
  cache.save(scope, 'home:personal', { mutedWords: [] });
  cache.save(scope, 'unrelated', { keep: true });
  const store = { cache, getSnapshot: () => ({ owner: 'account-a', scope, initialized: true, revision: 1 }), subscribe: () => () => {} };
  h.provide('@/lib/navigationCache', { getNavigationStore: () => store });
  let updates = 0;
  h.client.from = () => {
    let updating = false;
    const builder = {
      select() { return builder; },
      update() {
        updating = true; updates++;
        if (field === 'muted_words') assert.equal(cache.read(scope, 'home:personal'), null, 'invalidate before the server can commit');
        return builder;
      },
      eq() { return builder; }, setHeader() { return builder; }, abortSignal() { return builder; },
      maybeSingle: async () => ({ data: { [field]: ['existing'] }, error: null }),
      then(resolve, reject) { return Promise.resolve(updating ? write() : { data: null, error: null }).then(resolve, reject); },
    };
    return builder;
  };
  let current;
  const { useWordPreferences } = h.load('lib/useWordPreferences.ts');
  h.mount(() => { current = useWordPreferences(field); return null; });
  await h.flush();
  assert.equal(current.ready, true);
  return { h, cache, scope, save: next => current.save(next), get updates() { return updates; } };
}

test('saved mute changes invalidate remembered feed policy before the write and preserve other caches', async () => {
  const p = await preferences('muted_words', () => ({ error: null }));
  assert.equal(await p.save(['existing', 'new word']), true);
  assert.equal(p.updates, 1);
  assert.equal(p.cache.read(p.scope, 'home:personal'), null);
  assert.equal(p.cache.read(p.scope, 'unrelated').keep, true);
  p.h.dispose();
});

test('an ambiguous mute save cannot restore content using the previous policy', async () => {
  const p = await preferences('muted_words', () => { throw new Error('response lost after dispatch'); });
  assert.equal(await p.save(['existing', 'new word']), false);
  assert.equal(p.updates, 1);
  assert.equal(p.cache.read(p.scope, 'home:personal'), null);
  p.h.dispose();
});

test('comment hidden-word settings leave the independent feed policy cache intact', async () => {
  const p = await preferences('hidden_words', () => ({ error: null }));
  assert.equal(await p.save(['existing', 'new word']), true);
  assert.ok(p.cache.read(p.scope, 'home:personal'));
  p.h.dispose();
});
