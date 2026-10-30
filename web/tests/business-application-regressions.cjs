// Run: node web/tests/business-application-regressions.cjs
// Executes the real page with deferred provider responses. No hosted records.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const { webcrypto } = require('node:crypto');
const source = fs.readFileSync(process.env.BUSINESS_APPLY_SOURCE || path.join(__dirname, '../app/businesses/apply/page.tsx'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText;
const loginCompiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../app/business-login/page.tsx'), 'utf8'), { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText;
const ownedCompiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../app/businesses/page.tsx'), 'utf8'), { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText;
const text = n => typeof n === 'string' || typeof n === 'number' ? String(n)
  : Array.isArray(n) ? n.map(text).join('') : n?.props ? text(n.props.children) : '';
const nodes = n => !n || typeof n !== 'object' ? []
  : Array.isArray(n) ? n.flatMap(nodes) : [n, ...nodes(n.props?.children)];
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const row = (id, status = 'pending') => ({ id, company_name: `Company ${id}`, status, decision_reason: null });
const history = data => ({ data, error: null });
const businessId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const memberId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const device = { device_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', device_key: 'ab'.repeat(32) };
const boundSession = { business_id: businessId, member_id: memberId, role: 'owner', session: { access_token: 'synthetic-bound-access-token-only', refresh_token: 'synthetic-bound-refresh-only' } };
const ownedBusiness = { business_id: businessId, full_name: 'Example Business', username: 'example_business', avatar_url: null, role: 'owner', category: 'Media', is_verified: true, member_count: 2, post_count: 3 };

function harness(options = {}) {
  const slots = [], effects = [], timers = new Map();
  let cursor = 0, tree, timerId = 0, stateWrites = 0, callback, viewer = options.viewer === undefined ? 'owner-a' : options.viewer, accessToken = 'synthetic-personal-session';
  const calls = { reads: [], inserts: [], checks: [], invokes: [], verifies: [], sessions: [], routes: [], unsubscribes: 0 };
  const router = { replace: route => calls.routes.push(route), refresh() {} };
  const storage = new Map([['pc:business-device:v2', JSON.stringify(device)]]);
  const localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  const session = () => viewer ? { user: { id: viewer }, access_token: accessToken } : null;
  let getUser = token => ({ data: { user: token ? { id: businessId } : viewer ? { id: viewer } : null }, error: null });
  let getSession = () => ({ data: { session: session() }, error: null });
  let read = options.read || (() => history([]));
  let insert = () => ({ error: null });
  let check = () => ({ data: true, error: null });
  let businesses = () => ({ data: options.businesses ?? [ownedBusiness], error: null });
  let invoke = () => ({ data: boundSession, error: null });
  let install = tokens => { viewer = businessId; accessToken = tokens.access_token; const selected = session(); callback?.('SIGNED_IN', selected); return { data: { user: selected.user, session: selected }, error: null }; };
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const hooks = {
    useState(initial) { const key = cursor++; if (!(key in slots)) slots[key] = typeof initial === 'function' ? initial() : initial;
      return [slots[key], next => { stateWrites++; slots[key] = typeof next === 'function' ? next(slots[key]) : next; }]; },
    useRef(initial) { const key = cursor++; return slots[key] ??= { current: initial }; },
    useCallback(fn, deps) { const key = cursor++; if (!slots[key] || !same(slots[key].deps, deps)) slots[key] = { value: fn, deps }; return slots[key].value; },
    useEffect(fn, deps) { const key = cursor++; if (!slots[key] || !same(slots[key].deps, deps)) {
      const previous = slots[key]; slots[key] = { deps }; effects.push(() => { previous?.cleanup?.(); slots[key].cleanup = fn(); });
    } },
  };
  const client = {
    auth: {
      getUser: token => Promise.resolve().then(() => getUser(token)),
      getSession: () => Promise.resolve().then(() => getSession()),
      onAuthStateChange(fn) { callback = fn; return { data: { subscription: { unsubscribe() { callback = null; calls.unsubscribes++; } } } }; },
      verifyOtp(args) { calls.verifies.push(args); throw Error('Unbound magic-link handoff is forbidden'); },
      setSession(args) { calls.sessions.push(args); return Promise.resolve().then(() => install(args)); },
    },
    from(table) {
      assert.equal(table, 'business_applications');
      const args = {};
      const chain = {
        select(columns) { args.columns = columns; return chain; },
        eq(key, value) { args[key] = value; return chain; },
        order(key, value) { args.order = { key, ...value }; return chain; },
        limit(count) { args.limit = count; calls.reads.push({ ...args }); return Promise.resolve().then(() => read(args)); },
        insert(payload) { calls.inserts.push(payload); return Promise.resolve().then(() => insert(payload)); },
      };
      return chain;
    },
    rpc(name, args) { calls.checks.push({ name, args }); return Promise.resolve().then(() => name === 'get_my_businesses' ? businesses() : check(args.p_username)); },
    functions: { invoke(name, args) { calls.invokes.push({ name, args }); return Promise.resolve().then(() => invoke(args)); } },
  };
  const jsx = (type, props) => ({ type, props });
  const moduleObject = { exports: {} };
  const environment = {
    module: moduleObject, exports: moduleObject.exports, queueMicrotask,
    Error, AbortController, Uint8Array, crypto: webcrypto, localStorage,
    setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
    window: { location: { assign: route => calls.routes.push(route) } },
    require(id) {
      if (id === 'react') return hooks;
      if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
      if (id === '@/lib/supabase/client') return { createClient: () => client };
      if (id === '@/lib/businessAccess') return access;
      if (id === '@/lib/media') return { displayImageUrl: value => value };
      if (id === '@/components/VerifiedBadge') return { VerifiedBadge: 'VerifiedBadge' };
      if (id === 'next/navigation') return { useRouter: () => router };
      if (id === 'next/link') return { __esModule: true, default: 'Link' };
      if (id === 'lucide-react') return { ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', Briefcase: 'Briefcase', Building2: 'Building2', ShieldCheck: 'ShieldCheck', Plus: 'Plus' };
      throw new Error(`Unexpected import ${id}`);
    },
  };
  const accessModules = new Map();
  function loadAccess(file) {
    if (accessModules.has(file)) return accessModules.get(file);
    const exported = {}; accessModules.set(file, exported);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, { ...environment, exports: exported, require: id => loadAccess(path.resolve(path.dirname(file), id + '.ts')) });
    return exported;
  }
  const access = loadAccess(path.resolve(__dirname, '../lib/businessAccess.ts'));
  vm.runInNewContext(options.page === 'owned' ? ownedCompiled : options.page === 'login' ? loginCompiled : compiled, environment);
  const render = () => { cursor = 0; tree = moduleObject.exports.default(); effects.splice(0).forEach(fn => fn()); return tree; };
  const find = predicate => nodes(tree).find(predicate);
  const flush = async () => { for (let i = 0; i < 4; i++) { await new Promise(setImmediate); render(); } };
  const click = label => { const button = find(n => n.type === 'button' && text(n) === label); assert.ok(button, `Missing button ${label}`); button.props.onClick(); render(); };
  const field = name => find(n => ['input', 'textarea'].includes(n.type) && n.props.name === name);
  const change = (name, value) => { const input = field(name); assert.ok(input, `Missing field ${name}`); input.props.onChange({ target: { value } }); render(); };
  return {
    calls, render, flush, find, click, field, change, access, storage, localStorage,
    get text() { return text(tree); }, get nodes() { return nodes(tree); }, get stateWrites() { return stateWrites; }, get timerCount() { return timers.size; },
    setRead(fn) { read = fn; }, setInsert(fn) { insert = fn; }, setCheck(fn) { check = fn; }, setAuth(fn) { getUser = fn; }, setInvoke(fn) { invoke = fn; }, setInstall(fn) { install = fn; }, setSessionRead(fn) { getSession = fn; },
    setBusinesses(fn) { businesses = fn; },
    setViewer(next, emit = true, token = 'synthetic-personal-session') { viewer = next; accessToken = token; if (emit) callback?.(next ? 'SIGNED_IN' : 'SIGNED_OUT', session()); render(); },
    async runTimers() { const running = [...timers.values()]; timers.clear(); running.forEach(fn => { void fn(); }); await flush(); },
    submit() { find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); render(); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}
async function ready(options) { const h = harness(options); h.render(); await h.flush(); return h; }
async function fill(h) {
  h.change('company_name', ' Example Business '); h.change('description', ' Business description ');
  h.change('contact_email', 'owner@example.test'); h.change('desired_username', 'chosen_business'); await h.runTimers();
}

for (const failure of ['returned', 'thrown', 'missing']) {
  test(`history ${failure} failure has a retry state instead of an empty history`, async () => {
    const h = await ready({ read: () => { if (failure === 'thrown') throw new Error('offline'); return { data: null, error: failure === 'returned' ? { message: 'offline' } : null }; } });
    assert.match(h.text, /Applications could not be loaded/); assert.doesNotMatch(h.text, /no applications yet/);
    h.setRead(() => history([row('confirmed')])); h.click('Retry'); await h.flush();
    assert.match(h.text, /Company confirmed/); assert.doesNotMatch(h.text, /could not be loaded/);
    assert.equal(h.calls.reads[0].applicant_id, 'owner-a'); assert.equal(h.calls.reads[0].limit, 5);
  });
}

test('failed refresh preserves confirmed rows and successful retry replaces them', async () => {
  const h = await ready({ read: () => history([row('confirmed')]) });
  h.setRead(() => ({ data: null, error: { message: 'offline' } })); h.click('Refresh'); await h.flush();
  assert.match(h.text, /Company confirmed/); assert.match(h.text, /Applications could not be loaded/);
  h.setRead(() => history([row('new')])); h.click('Retry'); await h.flush();
  assert.match(h.text, /Company new/); assert.doesNotMatch(h.text, /Company confirmed/);
});

test('an initial account confirmation failure is retryable and never looks like signed-out success', async () => {
  const h = harness(); h.setAuth(() => ({ data: { user: null }, error: { message: 'offline' } })); h.render(); await h.flush();
  assert.match(h.text, /Your account could not be confirmed/); assert.doesNotMatch(h.text, /no applications yet/);
  h.setAuth(() => ({ data: { user: { id: 'owner-a' } }, error: null })); h.click('Retry'); await h.flush();
  assert.match(h.text, /no applications yet/); assert.equal(h.calls.reads.length, 1);
});

test('older history and account confirmation responses cannot replace the current account', async () => {
  const first = deferred(); const h = harness(); h.setAuth(() => first.promise); h.render(); await h.flush();
  h.setAuth(() => ({ data: { user: { id: 'owner-b' } }, error: null }));
  h.setRead(() => history([row('owner-b')])); h.setViewer('owner-b'); await h.flush();
  first.resolve({ data: { user: { id: 'owner-a' } }, error: null }); await h.flush();
  assert.match(h.text, /Company owner-b/); assert.equal(h.calls.reads.length, 1);
  const stale = deferred(); h.setRead(() => stale.promise); h.click('Refresh'); await h.flush();
  h.change('company_name', 'Private draft'); h.setViewer(null); await h.flush();
  stale.resolve(history([row('private-owner-b')])); await h.flush();
  assert.doesNotMatch(h.text, /Company owner-b|private-owner-b/); assert.equal(h.field('company_name').props.value, '');
  assert.match(h.text, /Sign in to your personal account/);
});

test('a late username result cannot change a newer invalid value or an edit-away-and-back result', async () => {
  const h = await ready(); const old = deferred(); h.setCheck(() => old.promise);
  h.change('desired_username', 'earlier'); await h.runTimers(); h.change('desired_username', '!');
  old.resolve({ data: true, error: null }); await h.flush();
  assert.doesNotMatch(h.text, /Available now/);
  const repeated = deferred(); let checks = 0;
  h.setCheck(() => ++checks === 1 ? repeated.promise : { data: false, error: null });
  h.change('desired_username', 'earlier'); await h.runTimers(); h.change('desired_username', 'later'); h.change('desired_username', 'earlier'); await h.runTimers();
  repeated.resolve({ data: true, error: null }); await h.flush();
  assert.match(h.text, /That handle is taken/); assert.doesNotMatch(h.text, /Available now/);
});

for (const failure of ['returned', 'thrown', 'missing']) {
  test(`availability ${failure} failure does not claim the handle is taken and can be retried`, async () => {
    const h = await ready(); h.setCheck(() => { if (failure === 'thrown') throw new Error('offline'); return { data: null, error: failure === 'returned' ? { message: 'offline' } : null }; });
    h.change('desired_username', 'chosen_business'); await h.runTimers();
    assert.match(h.text, /Could not check availability/); assert.doesNotMatch(h.text, /That handle is taken/);
    h.setCheck(() => ({ data: true, error: null })); h.click('Retry availability'); await h.runTimers();
    assert.match(h.text, /Available now/);
  });
}

test('duplicate sends make one write for the confirmed personal owner and refresh failures do not erase send success', async () => {
  const h = await ready(); await fill(h); const write = deferred(); h.setInsert(() => write.promise);
  h.submit(); h.submit(); await h.flush();
  assert.equal(h.calls.inserts.length, 1); assert.equal(h.find(n => n.type === 'fieldset').props.disabled, true);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.inserts[0])), {
    applicant_id: 'owner-a', company_name: 'Example Business', category: null, description: 'Business description',
    contact_email: 'owner@example.test', contact_phone: null, website: null, registration_info: null, desired_username: 'chosen_business',
  });
  assert.doesNotMatch(h.text, /Application sent/); h.setRead(() => ({ data: null, error: { message: 'offline' } }));
  write.resolve({ error: null }); await h.flush();
  assert.match(h.text, /Application sent/); assert.match(h.text, /Applications could not be loaded/);
  assert.equal(h.field('company_name').props.value, ''); assert.equal(h.find(n => n.type === 'fieldset').props.disabled, false);
});

for (const failure of ['returned', 'thrown']) {
  test(`a ${failure} send failure releases the form and preserves its draft`, async () => {
    const h = await ready(); await fill(h); h.setInsert(() => { if (failure === 'thrown') throw new Error('offline'); return { error: { message: 'denied' } }; });
    h.submit(); await h.flush(); assert.match(h.text, /could not be sent/); assert.doesNotMatch(h.text, /Application sent/);
    assert.equal(h.field('company_name').props.value, ' Example Business '); assert.equal(h.find(n => n.type === 'fieldset').props.disabled, false);
  });
}

for (const viewer of [null, 'owner-b']) {
  test(`send verifies identity before inserting if the session ${viewer ? 'changes' : 'expires'} without an auth event`, async () => {
    const h = await ready(); await fill(h); h.setViewer(viewer, false); h.submit(); await h.flush();
    assert.equal(h.calls.inserts.length, 0); assert.match(h.text, /could not be sent/);
  });
}

test('account switches discard old save results without clearing the new account draft', async () => {
  const h = await ready(); await fill(h); const old = deferred(); h.setInsert(() => old.promise); h.submit(); await h.flush();
  h.setViewer('owner-b'); await h.flush(); h.change('company_name', 'New owner draft');
  old.resolve({ error: null }); await h.flush();
  assert.equal(h.field('company_name').props.value, 'New owner draft'); assert.doesNotMatch(h.text, /Application sent/);
});

test('business access installs only the server-bound session and opens Studio after its own Auth event', async () => {
  const h = await ready({ read: () => history([row('approved-id', 'approved')]) });
  h.click('Open business'); await h.flush();
  assert.equal(h.calls.invokes[0].name, 'business-owner-access');
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.invokes[0].args.body)), { application_id: 'approved-id', ...device, device_label: 'Web browser' });
  assert.equal(h.calls.invokes[0].args.timeout, 15000);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.sessions)), [boundSession.session]);
  assert.deepEqual(h.calls.verifies, []); assert.deepEqual(h.calls.routes, ['/studio']);
});

for (const leave of ['account', 'unmount', 'silent-account']) {
  test(`a delayed bound business session is not installed after ${leave}`, async () => {
    const h = await ready({ read: () => history([row('approved-id', 'approved')]) }); const response = deferred(); h.setInvoke(() => response.promise);
    h.click('Open business'); await h.flush();
    if (leave === 'unmount') h.unmount(); else h.setViewer('owner-b', leave !== 'silent-account');
    const before = h.stateWrites;
    response.resolve({ data: boundSession, error: null }); await h.flush();
    assert.equal(h.calls.sessions.length, 0); assert.equal(h.calls.verifies.length, 0); assert.equal(h.calls.routes.length, 0);
    if (leave === 'unmount') assert.equal(h.stateWrites, before);
  });
}

test('unmount cancels queued checks, unsubscribes auth and suppresses late history or lookup state', async () => {
  const h = await ready(); const lookup = deferred(), historyRead = deferred(); h.setCheck(() => lookup.promise);
  h.change('desired_username', 'old_handle'); await h.runTimers(); h.change('desired_username', 'new_handle');
  h.setRead(() => historyRead.promise); h.click('Refresh'); await h.flush(); h.unmount();
  const before = h.stateWrites; lookup.resolve({ data: true, error: null }); historyRead.resolve(history([row('late')])); await h.flush();
  assert.equal(h.stateWrites, before); assert.equal(h.timerCount, 0); assert.equal(h.calls.unsubscribes, 1);
});

test('each form field has a persistent associated label and native keyboard submission constraints', async () => {
  const h = await ready(); const fields = h.nodes.filter(n => ['input', 'textarea'].includes(n.type));
  assert.equal(fields.length, 8);
  for (const field of fields) assert.ok(h.nodes.some(n => n.type === 'label' && n.props.htmlFor === field.props.id && text(n).length > 3), field.props.name);
  for (const name of ['company_name', 'description', 'contact_email', 'desired_username']) assert.equal(h.field(name).props.required, true);
  assert.equal(h.field('contact_email').props.type, 'email'); assert.equal(h.field('contact_phone').props.type, 'tel');
  const hint = h.find(n => n.props?.id === h.field('desired_username').props['aria-describedby']); assert.equal(hint.props.role, 'status');
  assert.equal(h.find(n => n.type === 'button' && text(n) === 'Send application').props.type, 'submit');
});

test('browser registration uses a stable random device pair and refuses corrupt or unavailable storage', () => {
  const h = harness(); h.storage.clear();
  const first = h.access.getBusinessDevice(), second = h.access.getBusinessDevice();
  assert.match(first.device_id, /^[0-9a-f-]{36}$/); assert.match(first.device_key, /^[0-9a-f]{64}$/);
  assert.notEqual(first.device_key, '0'.repeat(64)); assert.deepEqual(first, second);
  assert.deepEqual([...h.storage.keys()], ['pc:business-device:v2']);
  h.storage.set('pc:business-device:v2', '{broken'); assert.throws(() => h.access.getBusinessDevice(), /securely save/);
  assert.throws(() => h.access.getBusinessDevice({ getItem: () => null, setItem() {} }, webcrypto), /securely save/);
  assert.throws(() => h.access.getBusinessDevice({ getItem() { throw Error('denied'); }, setItem() {} }, webcrypto), /securely save/);
});

test('owner bootstrap requires an explicit, account-scoped second action', async () => {
  const h = await ready({ read: () => history([row('approved-id', 'approved')]) });
  h.setInvoke(args => args.body.bootstrap_owner ? { data: boundSession, error: null } : { data: { code: 'OWNER_BOOTSTRAP_REQUIRED', requires_owner_bootstrap: true }, error: null });
  h.click('Open business'); await h.flush();
  assert.match(h.text, /Set up your owner access/); assert.equal(h.calls.sessions.length, 0);
  assert.equal(h.calls.invokes.length, 1); assert.equal(h.calls.invokes[0].args.body.bootstrap_owner, undefined);
  h.click('Create my owner access'); await h.flush();
  assert.equal(h.calls.invokes[1].args.body.bootstrap_owner, true);
  assert.equal(h.calls.invokes[1].args.body.device_key, h.calls.invokes[0].args.body.device_key);
  assert.equal(h.calls.sessions.length, 1); assert.deepEqual(h.calls.routes, ['/studio']);
});

test('owner bootstrap confirmation disappears when the personal account changes', async () => {
  const h = await ready({ read: () => history([row('approved-id', 'approved')]) });
  h.setInvoke(() => ({ data: { code: 'OWNER_BOOTSTRAP_REQUIRED', requires_owner_bootstrap: true }, error: null }));
  h.click('Open business'); await h.flush(); const confirm = h.find(node => node.type === 'button' && text(node) === 'Create my owner access');
  h.setViewer('owner-b'); await h.flush();
  assert.doesNotMatch(h.text, /creates your owner seat/); confirm.props.onClick(); await h.flush();
  assert.equal(h.calls.invokes.length, 1); assert.equal(h.calls.sessions.length, 0);
});

test('cancelled owner access aborts the request, releases the form and ignores a late success', async () => {
  const h = await ready({ read: () => history([row('approved-id', 'approved')]) }), pending = deferred(); h.setInvoke(() => pending.promise);
  h.click('Open business'); await h.flush(); h.click('Cancel business sign-in'); await h.flush();
  assert.equal(h.calls.invokes[0].args.signal.aborted, true); assert.match(h.text, /Business sign-in cancelled/);
  assert.equal(h.find(node => node.type === 'fieldset').props.disabled, false);
  pending.resolve({ data: boundSession, error: null }); await h.flush();
  assert.equal(h.calls.sessions.length, 0); assert.deepEqual(h.calls.routes, []);
});

test('legacy unbound responses and an Auth destination mismatch never install an owner session', async () => {
  for (const mode of ['legacy', 'destination']) {
    const h = await ready({ read: () => history([row('approved-id', 'approved')]) });
    if (mode === 'legacy') h.setInvoke(() => ({ data: { token_hash: 'must-not-be-consumed' }, error: null }));
    else h.setAuth(token => ({ data: { user: { id: token ? 'wrong-business' : 'owner-a' } }, error: null }));
    h.click('Open business'); await h.flush(); assert.equal(h.calls.sessions.length, 0); assert.equal(h.calls.verifies.length, 0);
    assert.equal(h.calls.routes.length, 0); assert.ok(h.find(node => node.props?.role === 'alert'));
  }
});

async function loginReady(options = {}) {
  const h = await ready({ page: 'login', viewer: null, ...options });
  h.change('handle', '@Example_Business'); h.change('code', 'synthetic-team-code'); return h;
}
test('team sign-in validates the existing account, device and destination then opens Studio once', async () => {
  const h = await loginReady(); h.submit(); h.submit(); await h.flush();
  assert.equal(h.calls.invokes.length, 1); assert.equal(h.calls.invokes[0].name, 'business-signin');
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.invokes[0].args.body)), { handle: 'example_business', code: 'synthetic-team-code', ...device, device_label: 'Web browser' });
  assert.equal(h.calls.sessions.length, 1); assert.equal(h.calls.verifies.length, 0); assert.deepEqual(h.calls.routes, ['/studio']);
  assert.equal(h.field('code').props.value, '');
});
for (const code of ['DEVICE_APPROVAL_REQUIRED', 'DEVICE_BLOCKED', 'ACCESS_REJECTED', 'TRY_LATER']) {
  test(`team sign-in preserves the current account for ${code} and can retry`, async () => {
    const h = await loginReady({ viewer: 'owner-a' });
    h.setInvoke(() => ({ data: null, error: { context: new Response(JSON.stringify({ code, error: 'internal-private-provider-detail' }), { status: code === 'TRY_LATER' ? 429 : 403 }) } }));
    h.submit(); await h.flush(); assert.equal(h.calls.sessions.length, 0); assert.equal(h.calls.routes.length, 0);
    assert.ok(h.find(node => node.props?.role === 'alert')); assert.doesNotMatch(h.text, /internal-private-provider-detail/);
    assert.equal(h.find(node => node.type === 'fieldset').props.disabled, false);
    h.setInvoke(() => ({ data: boundSession, error: null })); h.submit(); await h.flush();
    assert.equal(h.calls.sessions.length, 1); assert.deepEqual(h.calls.routes, ['/studio']);
  });
}
for (const leave of ['cancel', 'account', 'silent-account', 'unmount']) {
  test(`team sign-in cannot install a late provider session after ${leave}`, async () => {
    const h = await loginReady({ viewer: 'owner-a' }), response = deferred(); h.setInvoke(() => response.promise); h.submit(); await h.flush();
    if (leave === 'cancel') h.click('Cancel sign-in'); else if (leave === 'unmount') h.unmount(); else h.setViewer('owner-b', leave !== 'silent-account');
    const before = h.stateWrites; response.resolve({ data: boundSession, error: null }); await h.flush();
    assert.equal(h.calls.sessions.length, 0); assert.deepEqual(h.calls.routes, []);
    if (leave !== 'silent-account') assert.equal(h.calls.invokes[0].args.signal.aborted, true);
    if (leave === 'unmount') assert.equal(h.stateWrites, before);
  });
}
test('team sign-in fails closed for a legacy response, destination mismatch, storage error or thrown network failure', async () => {
  for (const mode of ['legacy', 'destination', 'storage', 'network']) {
    const h = await loginReady();
    if (mode === 'legacy') h.setInvoke(() => ({ data: { token_hash: 'old-protocol' }, error: null }));
    if (mode === 'destination') h.setAuth(token => ({ data: { user: token ? { id: 'wrong-business' } : null }, error: null }));
    if (mode === 'storage') h.localStorage.getItem = () => { throw Error('blocked'); };
    if (mode === 'network') h.setInvoke(() => { throw Error('private-diagnostic'); });
    h.submit(); await h.flush(); assert.equal(h.calls.sessions.length, 0); assert.equal(h.calls.routes.length, 0); assert.equal(h.calls.verifies.length, 0);
    assert.equal(h.find(node => node.type === 'fieldset').props.disabled, false); assert.ok(h.find(node => node.props?.role === 'alert'));
    assert.doesNotMatch(h.text, /private-diagnostic/);
    if (mode === 'storage') assert.equal(h.calls.invokes.length, 0);
  }
});
test('a stalled team request times out and releases the retry controls', async () => {
  const h = await loginReady(); h.setInvoke(() => new Promise(() => {})); h.submit(); await h.flush(); await h.runTimers();
  assert.match(h.text, /took too long/); assert.equal(h.find(node => node.type === 'fieldset').props.disabled, false);
  assert.equal(h.calls.sessions.length, 0); assert.equal(h.calls.invokes[0].args.signal.aborted, true);
});
test('team session installation is non-cancellable and rejects an incorrect installed identity', async () => {
  const h = await loginReady(), installed = deferred(); h.setInstall(() => installed.promise); h.submit(); await h.flush();
  assert.match(h.text, /Opening Studio/); assert.equal(h.find(node => node.type === 'button' && text(node) === 'Cancel sign-in'), undefined);
  installed.resolve({ data: { user: { id: 'wrong-business' }, session: { user: { id: 'wrong-business' } } }, error: null }); await h.flush();
  assert.deepEqual(h.calls.routes, []); assert.match(h.text, /session could not be verified/);
});
test('initial team account-check errors are retryable and cannot enable sign-in from unknown identity', async () => {
  const h = harness({ page: 'login', viewer: null }); h.setSessionRead(() => { throw Error('offline'); }); h.render(); await h.flush();
  assert.match(h.text, /current account could not be checked/); assert.equal(h.find(node => node.type === 'fieldset').props.disabled, true);
  h.setSessionRead(() => ({ data: { session: null }, error: null })); h.click('Retry account check'); await h.flush();
  assert.equal(h.find(node => node.type === 'fieldset').props.disabled, false);
});

test('a missing personal Auth session still allows a validated team sign-in', async () => {
  const h = await loginReady(); h.setAuth(token => ({ data: { user: token ? { id: businessId } : null }, error: token ? null : { name: 'AuthSessionMissingError' } }));
  h.submit(); await h.flush(); assert.equal(h.calls.sessions.length, 1); assert.deepEqual(h.calls.routes, ['/studio']);
});

test('current owners launch their listed business by ID without requiring an application', async () => {
  const h = await ready({ page: 'owned' }); assert.ok(h.calls.checks.some(call => call.name === 'get_my_businesses'));
  h.click('Open Studio'); h.click('Open Studio'); await h.flush();
  assert.equal(h.calls.invokes.length, 1); assert.equal(h.calls.invokes[0].args.body.business_id, businessId); assert.equal('application_id' in h.calls.invokes[0].args.body, false);
  assert.equal(h.calls.sessions.length, 1); assert.deepEqual(h.calls.routes, ['/studio']);
});

test('nonowner business cards offer team sign-in without an owner-launch button', async () => {
  for (const role of ['admin', 'editor', 'member']) {
    const h = await ready({ page: 'owned', businesses: [{ ...ownedBusiness, role }] });
    assert.equal(h.find(node => node.type === 'button' && text(node) === 'Open Studio'), undefined);
    assert.ok(h.find(node => node.type === 'Link' && node.props.href === '/business-login')); assert.equal(h.calls.invokes.length, 0);
  }
});

test('owned-business bootstrap requires a second explicit action bound to the current owner', async () => {
  const h = await ready({ page: 'owned' }); h.setInvoke(() => ({ data: { code: 'OWNER_BOOTSTRAP_REQUIRED' }, error: null })); h.click('Open Studio'); await h.flush();
  assert.match(h.text, /creates your owner seat/); assert.equal(h.calls.invokes[0].args.body.bootstrap_owner, undefined);
  const old = h.find(node => node.type === 'button' && text(node) === 'Create my owner access'); h.setViewer('other-owner'); await h.flush(); old.props.onClick(); await h.flush(); assert.equal(h.calls.invokes.length, 1);
  h.click('Open Studio'); await h.flush(); h.setInvoke(() => ({ data: boundSession, error: null })); h.click('Create my owner access'); await h.flush();
  assert.equal(h.calls.invokes.at(-1).args.body.bootstrap_owner, true); assert.equal(h.calls.invokes.at(-1).args.body.business_id, businessId); assert.equal(h.calls.sessions.length, 1);
});

for (const page of ['apply', 'owned']) test(`${page} owner bootstrap cannot use a callback from a cancelled confirmation`, async () => {
  const h = await ready({ page, read: () => history([row('approved-id', 'approved')]) }); h.setInvoke(() => ({ data: { code: 'OWNER_BOOTSTRAP_REQUIRED' }, error: null }));
  h.click(page === 'owned' ? 'Open Studio' : 'Open business'); await h.flush();
  const old = h.find(node => node.type === 'button' && text(node) === 'Create my owner access'); h.click('Cancel setup'); old.props.onClick(); await h.flush();
  assert.equal(h.calls.invokes.length, 1); assert.equal(h.calls.sessions.length, 0);
});

for (const leave of ['cancel', 'account', 'silent-account', 'unmount']) test(`owned-business launch ignores a late result after ${leave}`, async () => {
  const h = await ready({ page: 'owned' }), response = deferred(); h.setInvoke(() => response.promise); h.click('Open Studio'); await h.flush();
  if (leave === 'cancel') h.click('Cancel sign-in'); else if (leave === 'unmount') h.unmount(); else h.setViewer('other-owner', leave !== 'silent-account');
  const writes = h.stateWrites; response.resolve({ data: boundSession, error: null }); await h.flush(); assert.equal(h.calls.sessions.length, 0); assert.equal(h.calls.routes.length, 0);
  if (leave === 'unmount') assert.equal(h.stateWrites, writes);
});

test('owned-business launch rejects another valid business identity and revoked ownership', async () => {
  for (const mode of ['identity', 'ownership', 'device']) {
    const h = await ready({ page: 'owned' }); h.setInvoke(() => mode === 'identity' ? { data: { ...boundSession, business_id: '66666666-6666-4666-8666-666666666666' }, error: null } : { data: { code: mode === 'ownership' ? 'ACTIVE_OWNER_SESSION_REQUIRED' : 'DEVICE_APPROVAL_REQUIRED' }, error: null });
    h.click('Open Studio'); await h.flush(); assert.equal(h.calls.sessions.length, 0); assert.equal(h.calls.routes.length, 0);
    assert.ok(h.find(node => node.props?.role === 'alert')); assert.doesNotMatch(h.text, /creates your owner seat/);
  }
});

test('owned-business list failures offer retry and old account rows cannot reappear', async () => {
  const h = harness({ page: 'owned' }); h.setBusinesses(() => ({ data: null, error: Error('private provider detail') })); h.render(); await h.flush();
  assert.match(h.text, /businesses could not be loaded/); assert.doesNotMatch(h.text, /private provider detail/);
  const response = deferred(); h.setBusinesses(() => response.promise); h.click('Retry'); await h.flush(); h.setBusinesses(() => ({ data: [], error: null })); h.setViewer('other-owner'); await h.flush();
  response.resolve({ data: [ownedBusiness], error: null }); await h.flush(); assert.doesNotMatch(h.text, /Example Business/); assert.match(h.text, /No businesses yet/);
});
