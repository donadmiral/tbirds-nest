// Real fetch/Response streams and installed Auth SDKs; no external requests.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const backend = 'https://business-auth.invalid';
const personal = '11111111-1111-4111-8111-111111111111', business = '22222222-2222-4222-8222-222222222222';
const defer = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const turn = () => new Promise(setImmediate);
function load(file, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports, URL, Request, Response, Headers, AbortController, Error, setTimeout, clearTimeout, ...globals }, { filename: file });
  return exports;
}
function fixture() {
  const timers = new Map(); let sequence = 0;
  const clock = { setTimeout(fn, ms) { const id = ++sequence; timers.set(id, { fn, ms }); return id; }, clearTimeout(id) { timers.delete(id); } };
  const helper = load('shared/authFetch.ts', clock);
  return { ...helper, timers, clock, deadline() { for (const [id, timer] of [...timers]) { if (timer.ms !== helper.AUTH_FETCH_DEADLINE_MS) continue; timers.delete(id); timer.fn(); } } };
}

test('Auth response retains original status, headers, URL metadata and readable bytes', async () => {
  const h = fixture(), headers = { 'content-type': 'application/json', 'x-provider-status': 'kept', 'set-cookie': 'synthetic-only=value' };
  const response = new Response(JSON.stringify({ id: business }), { status: 202, statusText: 'Accepted', headers });
  Object.defineProperty(response, 'url', { value: backend + '/auth/v1/user' });
  let options;
  const caller = new AbortController();
  const wrapped = h.createAuthDeadlineFetch(backend, async (_input, init) => { options = init; return response; });
  const result = await wrapped(backend + '/auth/v1/user', { method: 'GET', headers: { Authorization: 'Bearer synthetic' }, credentials: 'include', signal: caller.signal });
  assert.equal(result, response); assert.equal(result.status, 202); assert.equal(result.statusText, 'Accepted'); assert.equal(result.url, backend + '/auth/v1/user');
  assert.equal(result.headers.get('x-provider-status'), 'kept'); assert.equal(result.headers.get('set-cookie'), 'synthetic-only=value'); assert.equal(result.bodyUsed, false);
  assert.equal(options.credentials, 'include'); assert.equal(options.headers.Authorization, 'Bearer synthetic'); assert.notEqual(options.signal, caller.signal);
  assert.deepEqual(await result.json(), { id: business }); assert.equal(h.timers.size, 0);
});

test('Storage, REST, Edge and unrelated-origin streams bypass the Auth deadline unchanged', async () => {
  for (const address of [backend + '/storage/v1/object/video', backend + '/rest/v1/posts', backend + '/functions/v1/business-signin', backend + '/asset?next=/auth/v1/user', 'https://other.invalid/auth/v1/user', backend + '/auth/v10/user']) {
    const h = fixture(); let close, initSeen;
    const response = new Response(new ReadableStream({ start(controller) { close = () => controller.close(); } }));
    const init = { headers: { 'x-test': 'same' }, signal: new AbortController().signal };
    const wrapped = h.createAuthDeadlineFetch(backend, async (_input, options) => { initSeen = options; return response; });
    const result = await wrapped(address, init); assert.equal(result, response); assert.equal(initSeen, init); assert.equal(h.timers.size, 0); assert.equal(response.bodyUsed, false); close();
  }
});

test('pre-aborted Request and init signals never start Auth network work', async () => {
  const h = fixture(), caller = new AbortController(); caller.abort(); let calls = 0;
  const wrapped = h.createAuthDeadlineFetch(backend, async () => { calls++; return new Response('{}'); });
  await assert.rejects(wrapped(backend + '/auth/v1/user', { signal: caller.signal }), { name: 'AbortError' });
  await assert.rejects(wrapped(new Request(backend + '/auth/v1/user', { signal: caller.signal })), { name: 'AbortError' });
  assert.equal(calls, 0); assert.equal(h.timers.size, 0);
});

for (const reason of ['caller', 'deadline']) test(`Auth headers waiting for ${reason} cannot return a late response`, async () => {
  const h = fixture(), waiting = defer(), caller = new AbortController(); let signal;
  const wrapped = h.createAuthDeadlineFetch(backend, (_input, init) => { signal = init.signal; return waiting.promise; });
  const work = wrapped(new Request(backend + '/auth/v1/user', { signal: caller.signal }));
  const rejected = assert.rejects(work, { name: reason === 'caller' ? 'AbortError' : 'TimeoutError' });
  if (reason === 'caller') caller.abort(); else h.deadline(); await rejected;
  assert.equal(signal.aborted, true); assert.equal(h.timers.size, 0);
  waiting.resolve(new Response(JSON.stringify({ id: business }))); await turn(); await turn();
});

for (const reason of ['caller', 'deadline']) test(`the Auth ${reason} also aborts a body stalled after headers`, async () => {
  const h = fixture(), caller = new AbortController(); let signal, cancelled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"id":')); }, cancel() { cancelled = true; } });
  const wrapped = h.createAuthDeadlineFetch(backend, async (_input, init) => { signal = init.signal; return new Response(stream); });
  const work = wrapped(backend + '/auth/v1/user', { signal: caller.signal });
  const rejected = assert.rejects(work, { name: reason === 'caller' ? 'AbortError' : 'TimeoutError' });
  await turn(); await turn(); assert.equal(h.timers.size, 1);
  if (reason === 'caller') caller.abort(); else h.deadline(); await rejected; await turn();
  assert.equal(signal.aborted, true); assert.equal(h.timers.size, 0); assert.equal(cancelled, true);
});

test('native buffered-response fallback is bounded through arrayBuffer completion', async () => {
  const h = fixture(), body = defer(); let signal;
  const response = { headers: new Headers(), clone: () => ({ body: null, arrayBuffer: () => body.promise }), body: null };
  const wrapped = h.createAuthDeadlineFetch(backend, async (_input, init) => { signal = init.signal; return response; });
  const work = wrapped(backend + '/auth/v1/user'); const rejected = assert.rejects(work, { name: 'TimeoutError' });
  await turn(); h.deadline(); await rejected; assert.equal(signal.aborted, true);
  body.resolve(new Uint8Array([1, 2]).buffer); await turn(); assert.equal(h.timers.size, 0);
});

test('Auth body buffering is bounded for both declared and actual bytes', async () => {
  for (const advertised of [true, false]) {
    const h = fixture(); let signal;
    const response = new Response(advertised ? '{}' : new Uint8Array(h.AUTH_RESPONSE_MAX_BYTES + 1), { headers: advertised ? { 'content-length': String(h.AUTH_RESPONSE_MAX_BYTES + 1) } : undefined });
    const wrapped = h.createAuthDeadlineFetch(backend, async (_input, init) => { signal = init.signal; return response; });
    await assert.rejects(wrapped(backend + '/auth/v1/user'), /exceeds the supported size/); assert.equal(signal.aborted, true); assert.equal(h.timers.size, 0);
  }
});

test('caller abort listeners are removed after Auth success and failure', async () => {
  for (const failed of [false, true]) {
    const h = fixture(), listeners = new Set();
    const signal = { aborted: false, addEventListener(_event, fn) { listeners.add(fn); }, removeEventListener(_event, fn) { listeners.delete(fn); } };
    const wrapped = h.createAuthDeadlineFetch(backend, async () => { if (failed) throw Error('synthetic offline'); return new Response('{}'); });
    if (failed) await assert.rejects(wrapped(backend + '/auth/v1/user', { signal }), /synthetic offline/); else await wrapped(backend + '/auth/v1/user', { signal });
    assert.equal(listeners.size, 0); assert.equal(h.timers.size, 0);
  }
});

test('refresh grants preserve their 60-second budget through the body while login keeps 15 seconds', async () => {
  for (const grant of ['refresh_token', 'password']) {
    const h = fixture(); let signal;
    const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"access_token":')); } }));
    const wrapped = h.createAuthDeadlineFetch(backend, async (_input, init) => { signal = init.signal; return response; });
    const work = wrapped(backend + '/auth/v1/token?grant_type=' + grant, { method: 'POST' });
    const rejected = assert.rejects(work, { name: 'TimeoutError' }); await turn(); await turn();
    assert.equal(h.timers.size, 1);
    const [id, timer] = [...h.timers][0]; assert.equal(timer.ms, grant === 'refresh_token' ? 60_000 : 15_000);
    h.timers.delete(id); timer.fn(); await rejected; assert.equal(signal.aborted, true);
  }
});

const fixtureExpiresAt = Math.floor(Date.now() / 1000) + 3600;
const jwt = id => [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ sub: id, exp: fixtureExpiresAt })).toString('base64url'), 'synthetic-signature'].join('.');
const tokens = id => ({ access_token: jwt(id), refresh_token: 'synthetic-refresh-' + id });
for (const sdk of ['node_modules/@supabase/supabase-js', 'web/node_modules/@supabase/supabase-js']) {
  for (const stage of ['headers', 'body']) test(`${sdk} setSession rejects a stalled ${stage} without a late session write, then retries`, async () => {
    const { createClient } = require(path.join(root, sdk));
    const h = fixture(), values = new Map(), events = [], waiting = defer(); let mode = 'good', partial;
    const wrapped = h.createAuthDeadlineFetch(backend, async (_input, init) => {
      const id = String(new Headers(init.headers).get('authorization')).includes(jwt(business)) ? business : personal;
      if (id === business && mode === 'wait') {
        if (stage === 'headers') return waiting.promise;
        return new Response(new ReadableStream({ start(controller) { partial = controller; controller.enqueue(new TextEncoder().encode('{"id":')); } }));
      }
      return new Response(JSON.stringify({ id }), { headers: { 'content-type': 'application/json' } });
    });
    const client = createClient(backend, 'synthetic-public-anon', {
      auth: { autoRefreshToken: false, persistSession: true, detectSessionInUrl: false, storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) } },
      global: { fetch: wrapped },
    });
    const subscription = client.auth.onAuthStateChange((event, session) => { if (event === 'SIGNED_IN') events.push(session?.user.id); });
    try {
      assert.equal((await client.auth.setSession(tokens(personal))).error, null); mode = 'wait';
      const work = client.auth.setSession(tokens(business));
      for (let i = 0; i < 30 && h.timers.size === 0; i++) await turn();
      assert.equal(h.timers.size, 1); await turn(); h.deadline();
      const result = await work; assert.ok(result.error); assert.equal(result.data.session, null);
      if (stage === 'headers') waiting.resolve(new Response(JSON.stringify({ id: business })));
      else { try { partial.enqueue(new TextEncoder().encode('"' + business + '"}')); partial.close(); } catch { /* Correctly cancelled stream. */ } }
      await turn(); await turn();
      assert.equal((await client.auth.getSession()).data.session.user.id, personal); assert.deepEqual(events, [personal]);
      mode = 'good'; assert.equal((await client.auth.setSession(tokens(business))).error, null); assert.equal((await client.auth.getSession()).data.session.user.id, business);
    } finally { subscription.data.subscription.unsubscribe(); await client.auth.stopAutoRefresh(); }
  });
}

test('the web singleton factory installs the same Auth-only transport', async () => {
  const h = fixture(); let options, signal; const waiting = defer();
  const factory = load('web/lib/supabase/client.ts', {
    ...h.clock, process: { env: { NEXT_PUBLIC_SUPABASE_URL: backend, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-public' } },
    fetch: (_input, init) => { signal = init.signal; return waiting.promise; },
    require: name => name === '@supabase/ssr' ? { createBrowserClient(_url, _key, provided) { options = provided; return {}; } } : name === '../../../shared/authFetch' ? h : (() => { throw Error(name); })(),
  });
  factory.createClient(); const work = options.global.fetch(backend + '/auth/v1/user'); const rejected = assert.rejects(work, { name: 'TimeoutError' });
  h.deadline(); await rejected; assert.equal(signal.aborted, true); waiting.resolve(new Response('{}')); await turn();
});

test('actual native tab tree lands business accounts in Studio and personal accounts in Feed', () => {
  const file = fs.readFileSync(path.join(root, 'src/navigation/AppNavigator.tsx'), 'utf8');
  const ast = ts.createSourceFile('AppNavigator.tsx', file, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const node = ast.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === 'MainTabs'); assert.ok(node);
  const source = node.getText(ast) + '\nexports.MainTabs = MainTabs;';
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  for (const account_type of ['business', 'personal', 'creator', undefined]) {
    const exports = {}, jsx = (type, props) => ({ type, props });
    const scope = { exports, require: () => ({ jsx, jsxs: jsx }), useTheme: () => ({ t: {}, isDark: false }), useNavigationAccessibility: () => ({}), useSafeAreaInsets: () => ({ bottom: 0 }),
      useAuthStore: selector => selector({ profile: { id: account_type || 'unknown', account_type } }), useState: value => [value, () => {}], useEffect() {}, Platform: { OS: 'ios' },
      Tab: { Navigator: 'Navigator', Screen: 'Screen' }, FeedStackNav: 'Feed', NetworkStackNav: 'Market', StudioScreen: 'Studio', JobsStackNav: 'Jobs', MessagesStackNav: 'Messages', ProfileStackNav: 'Profile',
    };
    vm.runInNewContext(code, scope); const tree = exports.MainTabs();
    assert.equal(tree.props.initialRouteName, account_type === 'business' ? 'Studio' : 'Feed');
    const children = tree.props.children.filter(Boolean); assert.equal(children.some(child => child.props.name === tree.props.initialRouteName), true);
  }
});
