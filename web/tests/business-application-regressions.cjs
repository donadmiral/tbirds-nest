// Run: node web/tests/business-application-regressions.cjs
// Executes the real page with deferred provider responses. No hosted records.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const source = fs.readFileSync(process.env.BUSINESS_APPLY_SOURCE || path.join(__dirname, '../app/businesses/apply/page.tsx'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText;
const text = n => typeof n === 'string' || typeof n === 'number' ? String(n)
  : Array.isArray(n) ? n.map(text).join('') : n?.props ? text(n.props.children) : '';
const nodes = n => !n || typeof n !== 'object' ? []
  : Array.isArray(n) ? n.flatMap(nodes) : [n, ...nodes(n.props?.children)];
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const row = (id, status = 'pending') => ({ id, company_name: `Company ${id}`, status, decision_reason: null });
const history = data => ({ data, error: null });

function harness(options = {}) {
  const slots = [], effects = [], timers = new Map();
  let cursor = 0, tree, timerId = 0, stateWrites = 0, callback, viewer = options.viewer === undefined ? 'owner-a' : options.viewer;
  const calls = { reads: [], inserts: [], checks: [], invokes: [], verifies: [], routes: [], unsubscribes: 0 };
  let getUser = () => ({ data: { user: viewer ? { id: viewer } : null }, error: null });
  let read = options.read || (() => history([]));
  let insert = () => ({ error: null });
  let check = () => ({ data: true, error: null });
  let invoke = () => ({ data: { token_hash: 'approved-business-token' }, error: null });
  let verify = () => ({ data: { user: { id: 'business-account' } }, error: null });
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
      getUser: () => Promise.resolve().then(() => getUser()),
      onAuthStateChange(fn) { callback = fn; return { data: { subscription: { unsubscribe() { callback = null; calls.unsubscribes++; } } } }; },
      verifyOtp(args) { calls.verifies.push(args); return Promise.resolve().then(() => verify(args)); },
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
    rpc(name, args) { calls.checks.push({ name, args }); return Promise.resolve().then(() => check(args.p_username)); },
    functions: { invoke(name, args) { calls.invokes.push({ name, args }); return Promise.resolve().then(() => invoke(args)); } },
  };
  const jsx = (type, props) => ({ type, props });
  const moduleObject = { exports: {} };
  vm.runInNewContext(compiled, {
    module: moduleObject, exports: moduleObject.exports, queueMicrotask,
    setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
    window: { location: { assign: route => calls.routes.push(route) } },
    require(id) {
      if (id === 'react') return hooks;
      if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
      if (id === '@/lib/supabase/client') return { createClient: () => client };
      if (id === 'next/link') return { __esModule: true, default: 'Link' };
      if (id === 'lucide-react') return { ArrowLeft: 'ArrowLeft', Briefcase: 'Briefcase' };
      throw new Error(`Unexpected import ${id}`);
    },
  });
  const render = () => { cursor = 0; tree = moduleObject.exports.default(); effects.splice(0).forEach(fn => fn()); return tree; };
  const find = predicate => nodes(tree).find(predicate);
  const flush = async () => { for (let i = 0; i < 4; i++) { await new Promise(setImmediate); render(); } };
  const click = label => { const button = find(n => n.type === 'button' && text(n) === label); assert.ok(button, `Missing button ${label}`); button.props.onClick(); render(); };
  const field = name => find(n => ['input', 'textarea'].includes(n.type) && n.props.name === name);
  const change = (name, value) => { const input = field(name); assert.ok(input, `Missing field ${name}`); input.props.onChange({ target: { value } }); render(); };
  return {
    calls, render, flush, find, click, field, change,
    get text() { return text(tree); }, get nodes() { return nodes(tree); }, get stateWrites() { return stateWrites; }, get timerCount() { return timers.size; },
    setRead(fn) { read = fn; }, setInsert(fn) { insert = fn; }, setCheck(fn) { check = fn; }, setAuth(fn) { getUser = fn; }, setInvoke(fn) { invoke = fn; }, setVerify(fn) { verify = fn; },
    setViewer(next, emit = true) { viewer = next; if (emit) callback?.(next ? 'SIGNED_IN' : 'SIGNED_OUT', next ? { user: { id: next } } : null); render(); },
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

test('business access preserves the provider contract and completes an intentional account switch', async () => {
  const h = await ready({ read: () => history([row('approved-id', 'approved')]) });
  h.setVerify(() => { h.setViewer('business-account'); return { data: { user: { id: 'business-account' } }, error: null }; });
  h.click('Open business'); await h.flush();
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.invokes)), [{ name: 'business-owner-access', args: { body: { application_id: 'approved-id' } } }]);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.verifies)), [{ type: 'magiclink', token_hash: 'approved-business-token' }]);
  assert.deepEqual(h.calls.routes, ['/home']);
});

for (const leave of ['account', 'unmount', 'silent-account']) {
  test(`a delayed business-access token is not consumed after ${leave}`, async () => {
    const h = await ready({ read: () => history([row('approved-id', 'approved')]) }); const response = deferred(); h.setInvoke(() => response.promise);
    h.click('Open business'); await h.flush();
    if (leave === 'unmount') h.unmount(); else h.setViewer('owner-b', leave !== 'silent-account');
    const before = h.stateWrites;
    response.resolve({ data: { token_hash: 'late-token' }, error: null }); await h.flush();
    assert.equal(h.calls.verifies.length, 0); assert.equal(h.calls.routes.length, 0);
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
