const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

function load(name) {
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '../lib', name + '.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, AbortController, setTimeout, clearTimeout,
    require: id => { assert.equal(id, './withTimeout'); return load('withTimeout'); } });
  return module.exports;
}
const { loadNavigationProfile } = load('navigationProfile');
function fixture(run) {
  const request = {};
  const query = {
    select(value) { request.select = value; return this; },
    eq(key, value) { request[key] = value; return this; },
    abortSignal(signal) { request.signal = signal; return this; },
    maybeSingle() { return run(request); },
  };
  return { request, client: { from(table) { assert.equal(table, 'profiles'); return query; } } };
}
test('navigation uses the verified owner profile without persisting it across requests', async () => {
  const profile = { full_name: 'Member One', username: 'one', account_type: 'personal' };
  const first = fixture(() => Promise.resolve({ data: profile, error: null }));
  assert.equal(await loadNavigationProfile(first.client, 'owner-one'), profile);
  assert.equal(first.request.id, 'owner-one');
  const second = fixture(() => Promise.resolve({ data: null, error: null }));
  assert.equal(await loadNavigationProfile(second.client, 'owner-two'), null);
  assert.equal(second.request.id, 'owner-two');
});
test('a stalled optional profile read falls back and aborts the underlying request', async () => {
  let aborts = 0;
  const f = fixture(({ signal }) => { signal.addEventListener('abort', () => aborts++); return new Promise(() => {}); });
  assert.equal(await loadNavigationProfile(f.client, 'owner', 10), null);
  assert.equal(aborts, 1);
  assert.equal(f.request.signal.aborted, true);
});
test('an errored response never exposes a partial profile as verified navigation', async () => {
  const f = fixture(() => Promise.resolve({ data: { full_name: 'Partial' }, error: { message: 'Unavailable' } }));
  assert.equal(await loadNavigationProfile(f.client, 'owner'), null);
});
test('network rejection leaves the authorized page free to render neutral navigation', async () => {
  const f = fixture(() => Promise.reject(new Error('Network unavailable')));
  assert.equal(await loadNavigationProfile(f.client, 'owner'), null);
  assert.equal(f.request.signal.aborted, true);
});
