const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

// Run the actual Planner component with synthetic reads and writes. No hosted
// project, account, storage, or publishing endpoint is contacted.
const source = fs.readFileSync(process.env.PLANNER_SOURCE || path.join(__dirname, '../app/studio/planner/page.tsx'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node)
  : Array.isArray(node) ? node.map(text).join('') : text(node?.props?.children ?? '');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const listing = name => ({ id: name, title: name, price: 20, currency: 'USD', images: [] });
const community = (name, role = 'owner') => ({ id: name, name, my_role: role });

function harness({ products = async () => [], communities = async () => ({ data: [], error: null }), rows = [] } = {}) {
  const slots = [], effects = [], writes = [], calls = [];
  let cursor = 0, tree, stateWrites = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hooks = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], next => { stateWrites++; slots[i] = typeof next === 'function' ? next(slots[i]) : next; }];
    },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useMemo(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { value: fn(), deps }; return slots[i].value; },
    useCallback(fn, deps) { return hooks.useMemo(() => fn, deps); },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!slots[i] || !same(slots[i].deps, deps)) {
        slots[i]?.cleanup?.();
        slots[i] = { deps, effect: fn };
        effects.push(() => { slots[i].cleanup = fn(); });
      }
    },
  };
  const client = { rpc: (name, args) => { calls.push({ name, args }); return communities(); } };
  const runtime = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'Fragment' };
  const moduleObject = { exports: {} };
  const stubs = new Proxy({}, { get: (_, key) => String(key) });
  vm.runInNewContext(compiled, {
    exports: moduleObject.exports, module: moduleObject, console, alert() {}, confirm: () => true,
    require(id) {
      if (id === 'react') return hooks;
      if (id === 'react/jsx-runtime') return runtime;
      if (id === '@/lib/supabase/client') return { createClient: () => client };
      if (id === '@/components/StudioShell') return { useStudio: () => ({ me: { role: 'owner' } }) };
      if (id === '@/lib/categories') return { CATEGORIES: [] };
      if (id === '@/lib/studio') return {
        can: () => true, myListings: () => { calls.push({ name: 'myListings' }); return products(); },
        listScheduled: async () => rows,
        savePost: async input => { writes.push(input); return 'saved-draft'; },
      };
      if (id.endsWith('/LoadError')) return { StudioLoadError: 'StudioLoadError' };
      if (id === 'next/link') return { default: 'Link' };
      return stubs;
    },
  });
  const render = () => { cursor = 0; tree = moduleObject.exports.default(); effects.splice(0).forEach(fn => fn()); };
  const nodes = () => {
    const result = [];
    const walk = n => { if (!n || typeof n !== 'object') return; if (Array.isArray(n)) return n.forEach(walk); result.push(n); walk(n.props?.children); };
    walk(tree); return result;
  };
  const find = predicate => nodes().find(predicate);
  const click = label => { const node = find(n => n.type === 'button' && text(n).trim() === label.trim()); assert.ok(node, 'Missing button: ' + label); node.props.onClick(); render(); };
  const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); render(); };
  const unmount = () => slots.filter(s => s?.effect).forEach(s => s.cleanup?.());
  const error = word => find(n => n.type === 'StudioLoadError' && n.props.message?.startsWith(word));
  return { render, flush, find, click, unmount, error, writes, calls, get text() { return text(tree); }, get stateWrites() { return stateWrites; } };
}

test('a product failure is recoverable without clearing the draft or hiding successful communities', async () => {
  let fail = true;
  const app = harness({
    products: async () => { if (fail) throw new Error('offline'); return [listing('Available product')]; },
    communities: async () => ({ data: [community('Available community')], error: null }),
  });
  app.render(); await app.flush(); app.click('New post'); app.click('Products ');
  app.find(n => n.type === 'textarea').props.onChange({ target: { value: 'Keep this draft' } }); app.render();
  assert.ok(app.error('Products'));
  assert.equal(app.text.includes('No active listings'), false);
  assert.ok(app.text.includes('Available community'));
  const communityReads = app.calls.filter(c => c.name === 'get_communities').length;
  fail = false; app.error('Products').props.retry(); await app.flush();
  assert.ok(app.text.includes('Available product'));
  assert.equal(app.error('Products'), undefined);
  assert.equal(app.find(n => n.type === 'textarea').props.value, 'Keep this draft');
  assert.equal(app.calls.filter(c => c.name === 'get_communities').length, communityReads, 'retry only reloads the failed choice list');
});

for (const thrown of [false, true]) test(`a ${thrown ? 'thrown' : 'resolved'} community error is recoverable independently`, async () => {
  let fail = true;
  const app = harness({
    products: async () => [listing('Independent product')],
    communities: async () => {
      if (fail && thrown) throw new Error('offline');
      return fail ? { data: null, error: { message: 'offline' } }
        : { data: [community('Owner'), community('Moderator', 'moderator'), community('Member', 'member')], error: null };
    },
  });
  app.render(); await app.flush(); app.click('New post'); app.click('Products ');
  assert.ok(app.error('Communities'));
  assert.ok(app.text.includes('Independent product'));
  fail = false; app.error('Communities').props.retry(); await app.flush();
  assert.equal(app.error('Communities'), undefined);
  assert.ok(app.text.includes('Owner'));
  assert.ok(app.text.includes('Moderator'));
  assert.equal(app.text.includes('Member'), false, 'membership rules stay unchanged');
  assert.equal(app.calls.filter(c => c.name === 'myListings').length, 1);
  assert.deepEqual(app.calls.filter(c => c.name === 'get_communities').map(c => ({ ...c.args })), [
    { p_query: null, p_limit: 60 }, { p_query: null, p_limit: 60 },
  ]);
});

test('pending and failed products never pretend that the catalog is empty', async () => {
  const pending = deferred();
  const app = harness({ products: () => pending.promise });
  app.render(); app.click('New post'); app.click('Products ');
  assert.ok(app.text.includes('Loading products'));
  assert.equal(app.text.includes('No active listings'), false);
  pending.resolve([]); await app.flush();
  assert.equal(app.text.includes('Loading products'), false);
  assert.ok(app.text.includes('No active listings'), 'a successful empty catalog retains its existing message');
  assert.equal(app.error('Products'), undefined);
});

test('overlapping retries keep the newest data and ignore a late failure', async () => {
  let products = async () => { throw new Error('offline'); };
  let communities = async () => ({ data: null, error: { message: 'offline' } });
  const app = harness({ products: () => products(), communities: () => communities() });
  app.render(); await app.flush(); app.click('New post'); app.click('Products ');
  const retryProducts = app.error('Products').props.retry;
  const retryCommunities = app.error('Communities').props.retry;
  const oldProducts = deferred(), oldCommunities = deferred();
  products = () => oldProducts.promise; communities = () => oldCommunities.promise;
  retryProducts(); retryCommunities();
  products = async () => [listing('Newest product')];
  communities = async () => ({ data: [community('Newest community')], error: null });
  retryProducts(); retryCommunities(); await app.flush();
  oldProducts.reject(new Error('late failure'));
  oldCommunities.resolve({ data: [community('Stale community')], error: null });
  await app.flush();
  assert.ok(app.text.includes('Newest product'));
  assert.ok(app.text.includes('Newest community'));
  assert.equal(app.text.includes('Stale community'), false);
  assert.equal(app.error('Products'), undefined);
  assert.equal(app.error('Communities'), undefined);

  products = async () => { throw new Error('new failure'); };
  communities = async () => ({ data: null, error: { message: 'new failure' } });
  retryProducts(); retryCommunities(); await app.flush();
  assert.ok(app.error('Products'));
  assert.ok(app.error('Communities'));
  assert.ok(app.text.includes('Newest product'), 'failed refresh preserves previously loaded products');
  assert.ok(app.text.includes('Newest community'), 'failed refresh preserves previously loaded communities');
});

test('effect cleanup prevents stale choice responses from changing state after unmount', async () => {
  const products = deferred(), communities = deferred();
  const app = harness({ products: () => products.promise, communities: () => communities.promise });
  app.render(); await app.flush(); app.unmount();
  const before = app.stateWrites;
  products.resolve([listing('Unmounted')]); communities.resolve({ data: [community('Unmounted')], error: null });
  await app.flush();
  assert.equal(app.stateWrites, before);
});

test('an existing destination missing from choices stays explicit and is changed only by the editor', async () => {
  const existing = { id: 'post-1', status: 'draft', content: 'Existing draft', body: null, category: null, community_id: 'existing-community',
    publish_at: null, media: [], products: [ { title: 'Existing product', listing_id: 'existing-product' } ] };
  const app = harness({ rows: [existing] });
  app.render(); await app.flush(); app.click('Drafts'); app.click('Edit');
  const select = app.find(n => n.type === 'select');
  assert.ok(select, 'the saved destination must remain visible when absent from loaded choices');
  assert.equal(select.props.value, 'existing-community');
  assert.ok(app.find(n => n.type === 'option' && n.props.value === 'existing-community'));
  app.click('Save draft'); await app.flush();
  assert.equal(app.writes[0].community, 'existing-community');
  assert.equal(app.writes[0].products[0].listing_id, 'existing-product');
  app.click('Edit');
  app.find(n => n.type === 'select').props.onChange({ target: { value: '' } }); app.render();
  app.click('Save draft'); await app.flush();
  assert.equal(app.writes[1].community, null, 'only explicit Main feed selection clears the community');
});
