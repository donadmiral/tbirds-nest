const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === 'object' ? [value, ...nodes(value.props?.children)] : [];
const text = value => Array.isArray(value) ? value.map(text).join('') : typeof value === 'string' || typeof value === 'number' ? String(value) : text(value?.props?.children ?? '');
const business = { is_business: true, bound: true, needs_code: false, member_id: 'member-a', role: 'owner', display_name: 'Owner', business_name: 'Business A', username: 'business-a', avatar_url: null };

// Executes the production shell, studioMe RPC adapter and deadlines. Synthetic
// requests are independently controllable so optional reads can stay pending.
function fixture({ responses = {}, pathname = '/studio' } = {}) {
  const slots = [], effects = [], timers = new Map(), listeners = new Set(), calls = [], modules = new Map();
  let cursor = 0, dirty = false, sequence = 0, owner = 'account-a', tree, alive = true;
  const equal = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const hooks = {
    createContext: () => ({ Provider: 'StudioProvider' }), useContext: context => context,
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], next => { if (!alive) return; const value = typeof next === 'function' ? next(slots[i]) : next; if (!Object.is(value, slots[i])) { slots[i] = value; dirty = true; } }];
    },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useMemo(factory, deps) { const i = cursor++; if (!equal(slots[i]?.deps, deps)) slots[i] = { deps, value: factory() }; return slots[i].value; },
    useCallback(fn, deps) { return hooks.useMemo(() => fn, deps); },
    useEffect(effect, deps) { const i = cursor++, previous = slots[i]; if (equal(previous?.deps, deps)) return; const record = { deps }; slots[i] = record; effects.push(() => { previous?.cleanup?.(); record.cleanup = effect(); }); },
  };
  const session = () => owner ? { user: { id: owner } } : null;
  const request = name => {
    const call = { name, owner, filters: [], signal: null }; calls.push(call);
    const fallback = { data: name === 'studio_me' ? business : name === 'studio_surfaces' ? [] : null, error: null };
    const result = Promise.resolve(responses[name] ? responses[name](owner) : fallback);
    // Fake transport deliberately permits late completion after cancellation.
    // The production generation/owner guard must reject such results itself.
    const query = {
      select(columns) { call.columns = columns; return query; }, eq(key, value) { call.filters.push([key, value]); return query; },
      abortSignal(signal) { call.signal = signal; return query; }, maybeSingle() { return query; },
      then(resolve, reject) { return result.then(resolve, reject); },
    };
    return query;
  };
  const client = {
    auth: { getSession: async () => ({ data: { session: session() }, error: null }), onAuthStateChange(fn) { listeners.add(fn); return { data: { subscription: { unsubscribe: () => listeners.delete(fn) } } }; } },
    from: request, rpc: request,
  };
  const imports = {
    react: hooks, 'react/jsx-runtime': { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) },
    'next/navigation': { usePathname: () => pathname }, 'lucide-react': new Proxy({}, { get: (_, key) => key }),
    '@/components/NavigationLink': { NavigationLink: 'NavigationLink' }, '@/components/VerifiedBadge': { VerifiedBadge: 'VerifiedBadge' },
    '@/components/StudioSideRail': { StudioSideRail: 'StudioSideRail' }, '@/components/StudioRailPortal': { STUDIO_RAIL_SLOT: 'studio-rail' },
    '@/app/studio/LoadError': { StudioLoadError: 'StudioLoadError' }, '@/components/StudioDialog': { StudioDialog: 'StudioDialog' },
    '@/lib/supabase/client': { createClient: () => client }, '@/lib/media': {}, '../../shared/studioDraftRetry': {},
  };
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} }; modules.set(file, module);
    const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    vm.runInNewContext(code, { module, exports: module.exports, AbortController, queueMicrotask,
      window: { addEventListener() {}, removeEventListener() {} },
      setTimeout(fn, ms) { const id = ++sequence; timers.set(id, { fn, ms }); return id; }, clearTimeout(id) { timers.delete(id); },
      require(name) {
        if (name in imports) return imports[name];
        if (name.endsWith('.module.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) };
        if (name.startsWith('@/')) return load(name.slice(2) + '.ts');
        throw Error('Unexpected dependency ' + name);
      },
    });
    return module.exports;
  }
  const { StudioShell } = load('components/StudioShell.tsx');
  const content = { type: 'article', props: { children: 'Authorized workspace content' } };
  function render() {
    let iterations = 0;
    do { dirty = false; cursor = 0; tree = StudioShell({ children: content }); while (effects.length) effects.shift()(); assert.ok(++iterations < 20); } while (dirty);
    return tree;
  }
  render();
  return {
    calls, content, render,
    get tree() { return render(); }, get text() { return text(render()); },
    get provider() { return nodes(render()).find(node => node.type === 'StudioProvider'); },
    get error() { return nodes(render()).find(node => node.type === 'StudioLoadError')?.props.message; },
    get exit() { return nodes(render()).find(node => node.type === 'NavigationLink' && node.props.href === '/home'); },
    async flush() { for (let i = 0; i < 8; i++) { await new Promise(setImmediate); render(); } },
    setSession(next) { owner = next; },
    auth(next) { owner = next; for (const fn of [...listeners]) fn('SIGNED_IN', session()); render(); },
    expire(ms) { for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.fn(); } },
    dispose() { alive = false; slots.forEach(slot => slot?.cleanup?.()); },
  };
}

test('Studio keeps its return link usable during membership verification and opens before optional preferences', async t => {
  const membership = deferred(), profile = deferred(), preferences = deferred();
  const h = fixture({ responses: { studio_me: () => membership.promise, profiles: () => profile.promise, studio_surfaces: () => preferences.promise } });
  t.after(h.dispose); await h.flush();
  assert.ok(h.exit); assert.equal(h.provider, undefined); assert.doesNotMatch(h.text, /Authorized workspace content/);
  assert.equal(h.calls.filter(call => call.name === 'studio_surfaces').length, 0);
  profile.resolve({ data: { full_name: 'Cosmetic profile', verified_tier: 'gold' }, error: null }); await h.flush();
  assert.equal(h.provider, undefined, 'A cosmetic profile cannot authorize Studio');
  membership.resolve({ data: business, error: null }); await h.flush();
  assert.equal(h.provider.props.value.me.role, 'owner'); assert.ok(nodes(h.tree).includes(h.content));
  assert.equal(h.calls.find(call => call.name === 'studio_surfaces').signal.aborted, false);
  assert.ok(h.exit); assert.doesNotMatch(h.text, /Opening your workspace/);
  preferences.resolve({ data: ['content'], error: null }); await h.flush();
  assert.ok(nodes(h.tree).includes(h.content));
});

test('a late creator profile updates cosmetic fields without changing workspace identity or its content node', async t => {
  const profile = deferred();
  const h = fixture({ responses: { studio_me: () => ({ data: { is_business: false }, error: null }), profiles: () => profile.promise } });
  t.after(h.dispose); await h.flush(); const key = h.provider.key;
  assert.equal(h.provider.props.value.me.is_business, false); assert.ok(nodes(h.tree).includes(h.content));
  profile.resolve({ data: { full_name: 'Creator A', username: 'creator-a', avatar_url: 'avatar-a' }, error: null }); await h.flush();
  assert.equal(h.provider.key, key); assert.ok(nodes(h.tree).includes(h.content));
  assert.equal(h.provider.props.value.me.display_name, 'Creator A'); assert.equal(h.provider.props.value.me.role, null);
  assert.equal(h.calls.some(call => call.name === 'studio_surfaces'), false);
});

test('optional profile and preference failures preserve verified workspace access', async t => {
  const profile = deferred(), preferences = deferred();
  const h = fixture({ responses: { profiles: () => profile.promise, studio_surfaces: () => preferences.promise } });
  t.after(h.dispose); await h.flush(); const key = h.provider.key;
  profile.reject(Error('Profile unavailable')); preferences.resolve({ data: null, error: { message: 'Preference unavailable' } }); await h.flush();
  assert.equal(h.provider.key, key); assert.equal(h.provider.props.value.me.role, 'owner');
  assert.match(h.error, /desk preferences/); assert.ok(nodes(h.tree).includes(h.content)); assert.ok(h.exit);
});

test('failed or timed out membership still denies workspace content and cancels outstanding reads', async t => {
  for (const mode of ['error', 'timeout']) {
    const membership = deferred(), profile = deferred();
    const h = fixture({ responses: { studio_me: () => membership.promise, profiles: () => profile.promise } });
    t.after(h.dispose); await h.flush();
    if (mode === 'error') membership.resolve({ data: business, error: { message: 'Not authorized' } }); else h.expire(12000);
    await h.flush();
    assert.equal(h.provider, undefined); assert.match(h.error, /could not verify this session/); assert.ok(h.exit);
    assert.doesNotMatch(h.text, /Authorized workspace content/);
    for (const call of h.calls) assert.equal(call.signal.aborted, true, call.name);
    assert.equal(h.calls.some(call => call.name === 'studio_surfaces'), false);
  }
});

test('optional deadlines cancel their transports while leaving the verified workspace active', async t => {
  const pending = deferred();
  const h = fixture({ responses: { profiles: () => pending.promise, studio_surfaces: () => pending.promise } });
  t.after(h.dispose); await h.flush(); const key = h.provider.key;
  h.expire(5000); await h.flush();
  assert.equal(h.provider.key, key); assert.ok(nodes(h.tree).includes(h.content)); assert.match(h.error, /desk preferences/);
  for (const call of h.calls) assert.equal(call.signal.aborted, true, call.name);
});

test('account replacement cancels old reads and discards their late profile and preference results', async t => {
  const oldProfile = deferred(), oldPreferences = deferred(), newMembership = deferred();
  const h = fixture({ responses: {
    profiles: uid => uid === 'account-a' ? oldProfile.promise : { data: { full_name: 'Creator B' }, error: null },
    studio_me: uid => uid === 'account-a' ? { data: business, error: null } : newMembership.promise,
    studio_surfaces: () => oldPreferences.promise,
  } });
  t.after(h.dispose); await h.flush(); assert.equal(h.provider.props.value.accountId, 'account-a');
  h.auth('account-b'); assert.equal(h.provider, undefined); await h.flush();
  for (const call of h.calls.filter(call => call.owner === 'account-a')) assert.equal(call.signal.aborted, true);
  oldProfile.resolve({ data: { full_name: 'STALE ACCOUNT', verified_tier: 'gold' }, error: null });
  oldPreferences.resolve({ data: null, error: { message: 'Stale error' } }); await h.flush();
  assert.equal(h.provider, undefined); assert.doesNotMatch(h.text, /STALE ACCOUNT|Business A/);
  newMembership.resolve({ data: { is_business: false }, error: null }); await h.flush();
  assert.equal(h.provider.props.value.accountId, 'account-b'); assert.equal(h.provider.props.value.me.display_name, 'Creator B');
  assert.equal(h.provider.props.value.me.role, null); assert.equal(h.error, null); assert.doesNotMatch(h.text, /STALE ACCOUNT|Business A/);
});

test('creator routes and member-code requirements remain gated after optional profile completion', async t => {
  for (const member of [{ is_business: false }, { ...business, needs_code: true, bound: false, role: null }]) {
    const h = fixture({ pathname: '/studio/team', responses: { studio_me: () => ({ data: member, error: null }), profiles: () => ({ data: { full_name: 'Cosmetic', is_business: true, role: 'owner' }, error: null }) } });
    t.after(h.dispose); await h.flush();
    assert.doesNotMatch(h.text, /Authorized workspace content/);
    assert.match(h.text, member.is_business ? /Who is working/ : /business workspace is required/);
  }
});

test('a refresh that discovers an account change cannot retain the previous creator display fields', async t => {
  const nextMembership = deferred(), nextProfile = deferred();
  const h = fixture({ responses: {
    studio_me: uid => uid === 'account-a' ? { data: { is_business: false }, error: null } : nextMembership.promise,
    profiles: uid => uid === 'account-a' ? { data: { full_name: 'Previous creator', username: 'previous-creator' }, error: null } : nextProfile.promise,
  } });
  t.after(h.dispose); await h.flush(); assert.match(h.text, /Previous creator/);
  h.setSession('account-b'); const refresh = h.provider.props.value.refresh(); await h.flush();
  assert.equal(h.provider, undefined); assert.doesNotMatch(h.text, /Previous creator/);
  nextMembership.resolve({ data: { is_business: false }, error: null }); await refresh; await h.flush();
  assert.equal(h.provider.props.value.accountId, 'account-b'); assert.equal(h.provider.props.value.me.display_name, null);
  assert.doesNotMatch(h.text, /Previous creator/);
});

test('leaving Studio cancels outstanding membership and profile reads', async () => {
  const pending = deferred(), h = fixture({ responses: { studio_me: () => pending.promise, profiles: () => pending.promise } });
  await h.flush(); h.dispose();
  assert.equal(h.calls.length, 2); for (const call of h.calls) assert.equal(call.signal.aborted, true, call.name);
});
