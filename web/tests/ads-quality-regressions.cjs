const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test: nodeTest } = require('node:test');
const test = (name, fn) => nodeTest(name, { timeout: 3000 }, fn);
const ts = require('typescript');
const { execFileSync } = require('node:child_process');

function compile(file, requireModule, globals = {}) {
  const source = process.env.ADS_BASELINE_REF ? execFileSync('git', ['show', process.env.ADS_BASELINE_REF + ':web/' + file], { encoding: 'utf8' }) : fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const module = { exports: {} };
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: requireModule, Date, Error, console, ...globals });
  return module.exports;
}
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(setImmediate); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const promo = (id = 'one', advertiser_id = 'account-a') => ({ id, advertiser_id, post_id: 'post', status: 'active', starts_at: '2026-10-01', created_at: '2026-10-01', ends_at: null, total_cap: null, label: 'Sponsored', impressions_count: 12, clicks_count: 3 });

function library({ query = async () => ({ data: [], count: 0, error: null }), rpc = async () => ({ error: null }) } = {}) {
  let uid = 'account-a';
  const calls = [];
  const client = {
    auth: { getSession: async () => ({ data: { session: uid ? { user: { id: uid } } : null }, error: null }) },
    rpc: async (name, args) => { calls.push({ rpc: name, args }); return rpc(name, args); },
    from(table) {
      const call = { table, methods: [] }; calls.push(call);
      const builder = { then: (yes, no) => Promise.resolve().then(() => query(call)).then(yes, no) };
      for (const method of ['select', 'eq', 'gte', 'lte', 'order', 'range', 'update', 'maybeSingle']) builder[method] = (...args) => { call.methods.push([method, ...args]); return builder; };
      return builder;
    },
  };
  const api = compile('lib/ads.ts', id => id === '@/lib/supabase/client' ? { createClient: () => client } : {});
  return { api, calls, setUser: value => { uid = value; } };
}

test('delivery status excludes expired, scheduled and exhausted promotions from active delivery', () => {
  const app = library();
  const at = Date.parse('2026-10-18T12:00:00Z');
  const current = promo();
  assert.equal(app.api.promoDeliveryStatus(current, at), 'Active');
  assert.equal(app.api.promoDeliveryStatus({ ...current, ends_at: '2026-10-17T12:00:00Z' }, at), 'Expired');
  assert.equal(app.api.promoDeliveryStatus({ ...current, starts_at: '2026-10-19T12:00:00Z' }, at), 'Scheduled');
  assert.equal(app.api.promoDeliveryStatus({ ...current, total_cap: 12 }, at), 'Limit reached');
  assert.equal(app.api.promoDeliveryStatus({ ...current, total_cap: 0 }, at), 'Limit reached');
  assert.equal(app.api.promoDeliveryStatus({ ...current, status: 'paused' }, at), 'Paused');
  assert.equal(app.api.promoDeliveryStatus({ ...current, status: 'ended' }, at), 'Ended');
});

test('ad status is scoped to the selected account and previous status and requires a returned match', async () => {
  let result = { data: { id: 'one', advertiser_id: 'account-a', status: 'paused' }, error: null };
  const app = library({ query: async () => result });
  assert.equal(await app.api.setPromoStatus('one', 'paused', 'account-a', 'active'), true);
  const methods = app.calls[0].methods;
  assert.ok(methods.some(m => m[0] === 'eq' && m[1] === 'advertiser_id' && m[2] === 'account-a'));
  assert.ok(methods.some(m => m[0] === 'eq' && m[1] === 'status' && m[2] === 'active'));
  for (const data of [null, { id: 'other', advertiser_id: 'account-a', status: 'paused' }, { id: 'one', advertiser_id: 'account-b', status: 'paused' }, { id: 'one', advertiser_id: 'account-a', status: 'active' }]) {
    result = { data, error: null };
    assert.equal(await app.api.setPromoStatus('one', 'paused', 'account-a', 'active'), false);
  }
});

test('account changes prevent ad writes and suppress an obsolete success', async () => {
  const pending = deferred();
  const app = library({ query: () => pending.promise });
  app.setUser('account-b');
  await assert.rejects(app.api.setPromoStatus('one', 'paused', 'account-a', 'active'));
  assert.equal(app.calls.length, 0);
  app.setUser('account-a');
  const writing = app.api.setPromoStatus('one', 'paused', 'account-a', 'active');
  await flush(); app.setUser('account-b');
  pending.resolve({ data: { id: 'one', advertiser_id: 'account-a', status: 'paused' }, error: null });
  await assert.rejects(writing);
});

test('failed and truncated promo reads never become an empty or partial success', async () => {
  for (const result of [{ data: null, error: { message: 'denied' } }, { data: [promo()], count: 2, error: null }]) {
    const app = library({ query: async () => result });
    await assert.rejects(app.api.myPromos('account-a'));
  }
  const app = library(); app.setUser(null);
  await assert.rejects(app.api.myPromos('account-a'));
});

test('promo reads reject a response for a previous account', async () => {
  const pending = deferred();
  const app = library({ query: () => pending.promise });
  const reading = app.api.myPromos('account-a'); await flush(); app.setUser('account-b');
  pending.resolve({ data: [promo()], count: 1, error: null });
  await assert.rejects(reading);
});

test('performance reads all pages and filters to this advertiser and a fixed UTC window', async () => {
  const day = new Date().toISOString().slice(0, 10);
  const rows = Array.from({ length: 1250 }, (_, i) => ({ id: String(i), kind: i % 2 ? 'click' : 'impression', created_at: day + 'T00:00:00Z' }));
  const app = library({ query: async call => {
    const range = call.methods.find(m => m[0] === 'range');
    return { data: rows.slice(range[1], range[2] + 1), count: rows.length, error: null };
  } });
  const result = await app.api.myPromoPerformance('account-a');
  assert.equal(result.length, 30);
  assert.equal(result.reduce((n, r) => n + r.impressions, 0), 625);
  assert.equal(result.reduce((n, r) => n + r.clicks, 0), 625);
  assert.equal(app.calls.length, 3);
  for (const call of app.calls) {
    assert.ok(call.methods.some(m => m[0] === 'eq' && m[1] === 'promoted_posts.advertiser_id' && m[2] === 'account-a'));
    assert.ok(call.methods.some(m => m[0] === 'gte' && m[2].endsWith('T00:00:00.000Z')));
    assert.ok(call.methods.some(m => m[0] === 'order' && m[1] === 'id'));
  }
  assert.equal(new Set(app.calls.map(c => c.methods.find(m => m[0] === 'lte')[2])).size, 1);
});

for (const [name, result] of [
  ['denied', { data: null, count: null, error: { message: 'denied' } }],
  ['truncated', { data: [{ id: 'one', kind: 'impression', created_at: new Date().toISOString() }], count: 2, error: null }],
  ['unbounded', { data: [], count: 10001, error: null }],
]) test(`${name} performance never produces a misleading chart`, async () => {
  const app = library({ query: async () => result });
  await assert.rejects(app.api.myPromoPerformance('account-a'));
  assert.equal(app.calls.length, 1);
});

test('returned and thrown analytics failures remain retryable', async () => {
  for (const thrown of [false, true]) {
    let attempts = 0;
    const app = library({ rpc: async () => { attempts++; if (attempts === 1) { if (thrown) throw Error('offline'); return { error: { message: 'offline' } }; } return { error: null }; } });
    app.api.recordAdEvent('one', 'impression'); await flush();
    app.api.recordAdEvent('one', 'impression'); await flush();
    app.api.recordAdEvent('one', 'impression'); await flush();
    assert.equal(attempts, 2);
  }
});

test('analytics deduplication is isolated by account and coalesces concurrent attempts', async () => {
  const pending = deferred();
  const app = library({ rpc: () => pending.promise });
  app.api.recordAdEvent('one', 'click'); await flush();
  app.api.recordAdEvent('one', 'click'); await flush();
  app.api.recordAdEvent('one', 'click'); await flush();
  assert.equal(app.calls.length, 1, 'duplicate callers cannot clear the first pending entry');
  pending.resolve({ error: null }); await flush();
  app.api.recordAdEvent('one', 'click'); await flush();
  assert.equal(app.calls.length, 1);
  app.setUser('account-b'); app.api.recordAdEvent('one', 'click'); await flush();
  assert.equal(app.calls.length, 2);
  app.setUser(null); app.api.recordAdEvent('other', 'click'); await flush();
  assert.equal(app.calls.length, 2);
});

const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : text(node?.props?.children ?? '');
function page({ read = async () => [promo()], chart = async () => [], write = async () => true } = {}) {
  const slots = [], effects = [], calls = [];
  let cursor = 0, tree, listener, writes = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], next => { writes++; slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useCallback(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { value: fn, deps }; return slots[i].value; },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || !same(slots[i].deps, deps)) { slots[i]?.cleanup?.(); slots[i] = { deps, effect: fn }; effects.push(() => { slots[i].cleanup = fn(); }); } },
  };
  const client = { auth: {
    getSession: async () => ({ data: { session: { user: { id: 'account-a' } } }, error: null }),
    onAuthStateChange: fn => { listener = fn; return { data: { subscription: { unsubscribe() {} } } }; },
  } };
  const jsx = (type, props) => ({ type, props });
  const stubs = new Proxy({}, { get: (_, key) => String(key) });
  const component = compile('app/ads/page.tsx', id => {
    if (id === 'react') return hooks;
    if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (id === '@/lib/supabase/client') return { createClient: () => client };
    if (id === '@/lib/ads') return {
      promoDeliveryStatus: (p, at) => p.status === 'active' ? 'Active' : p.status === 'paused' ? 'Paused' : 'Ended',
      myPromos: uid => { calls.push(['read', uid]); return read(uid); },
      myPromoPerformance: uid => { calls.push(['chart', uid]); return chart(uid); },
      setPromoStatus: (...args) => { calls.push(['write', ...args]); return write(...args); },
    };
    if (id === 'next/link') return { default: 'Link' };
    return stubs;
  }, { window: { confirm: () => true } }).default;
  const render = () => { cursor = 0; tree = component(); effects.splice(0).forEach(fn => fn()); };
  const nodes = () => { const result = []; const walk = n => { if (!n || typeof n !== 'object') return; if (Array.isArray(n)) return n.forEach(walk); result.push(n); walk(n.props?.children); }; walk(tree); return result; };
  const button = label => nodes().find(n => n.type === 'button' && text(n).trim() === label);
  return {
    render, button, calls, nodes,
    flush: async () => { await flush(); render(); },
    changeUser(uid) { listener('SIGNED_IN', uid ? { user: { id: uid } } : null); render(); },
    unmount() { slots.filter(s => s?.effect).forEach(s => s.cleanup?.()); },
    get text() { return text(tree); }, get writes() { return writes; },
  };
}

test('failed ad loads show recovery without claiming there are no campaigns', async () => {
  let failure = true;
  const app = page({ read: async () => { if (failure) throw Error('offline'); return [promo()]; } });
  app.render(); await app.flush();
  assert.ok(app.text.includes('could not be refreshed'));
  assert.ok(!app.text.includes('No campaigns yet'));
  assert.ok(!app.text.includes('Loading'));
  failure = false; app.button('Try again').props.onClick(); await app.flush();
  assert.ok(app.button('Pause'));
  assert.ok(!app.text.includes('could not be refreshed'));
});

test('chart failures remain distinct from successful promotion totals', async () => {
  const app = page({ chart: async () => { throw Error('Chart unavailable'); } });
  app.render(); await app.flush();
  assert.ok(app.text.includes('Chart unavailable'));
  assert.ok(app.button('Pause'));
  assert.equal(app.nodes().filter(n => n.type === 'TrendChart').length, 0);
});

test('status changes stay unchanged until confirmed and prevent double submission', async () => {
  const pending = deferred();
  const app = page({ write: () => pending.promise });
  app.render(); await app.flush();
  const pause = app.button('Pause').props.onClick;
  pause(); pause(); app.render();
  assert.equal(app.calls.filter(c => c[0] === 'write').length, 1);
  assert.equal(app.button('Pause').props.disabled, true);
  assert.equal(app.button('Resume'), undefined);
  pending.resolve(true); await app.flush();
  assert.ok(app.button('Resume'));
  assert.equal(app.button('Pause'), undefined);
});

for (const thrown of [false, true]) test(`a ${thrown ? 'thrown' : 'zero-row'} status failure remains visible and requires refresh`, async () => {
  const app = page({ write: async () => { if (thrown) throw Error('offline'); return false; } });
  app.render(); await app.flush(); app.button('Pause').props.onClick(); await app.flush();
  assert.ok(app.text.includes('could not be confirmed'));
  assert.equal(app.button('Pause').props.disabled, true);
  assert.equal(app.button('Resume'), undefined);
  app.button('Refresh').props.onClick(); await app.flush();
  assert.equal(app.button('Pause').props.disabled, false);
});

test('account switches hide old campaigns and late responses cannot repopulate them', async () => {
  const old = deferred();
  const app = page({ read: uid => uid === 'account-a' ? old.promise : Promise.resolve([promo('account-b-promo', uid)]) });
  app.render(); await app.flush(); app.changeUser('account-b'); await app.flush();
  old.resolve([promo()]); await app.flush();
  assert.ok(app.button('Pause'));
  app.button('Pause').props.onClick(); await app.flush();
  assert.equal(app.calls.find(c => c[0] === 'write')[1], 'account-b-promo');
});

test('an old write cannot change the new account even after switching A to B to A', async () => {
  const pending = deferred();
  const app = page({ write: () => pending.promise });
  app.render(); await app.flush(); app.button('Pause').props.onClick();
  app.changeUser('account-b'); await app.flush(); app.changeUser('account-a'); await app.flush();
  pending.resolve(true); await app.flush();
  assert.ok(app.button('Pause'));
  assert.equal(app.button('Resume'), undefined);
});

test('responses after unmount do not write page state', async () => {
  const pending = deferred(); const app = page({ read: () => pending.promise, chart: () => pending.promise });
  app.render(); await app.flush(); app.unmount(); const before = app.writes;
  pending.resolve([]); await app.flush();
  assert.equal(app.writes, before);
});
