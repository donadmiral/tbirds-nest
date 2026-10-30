// Run: node web/tests/username-regressions.cjs
// Add --baseline to demonstrate failures against the pre-fix source blobs.
// Exercises real component handlers. No browser, account, or network is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const baseline = {
  'components/Nav.tsx': '25968f3532bef985ff705bf601573afa5f35b5ac',
  'components/TopBar.tsx': '13dce1e619a649f3299e8836aec7e85bff352f28',
  'components/AccountStatus.tsx': '2e908b4508d4bf4c967484e7d65997179812b112',
  'app/settings/username/page.tsx': 'f5c62aaebb5da9b10a1abd0166de50b92218c897',
};
const flush = () => new Promise(setImmediate);
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const nodes = node => !node || typeof node !== 'object' ? []
  : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node)
  : Array.isArray(node) ? node.map(text).join('') : node?.props ? text(node.props.children) : '';
const navigationModule = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'web/lib/navigation.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: navigationModule, exports: navigationModule.exports });

function harness(file, name = 'default', props = {}) {
  const values = [], effects = [], queued = [], timers = new Map();
  let slot = 0, timer = 0, viewer = 'viewer-a';
  const calls = { writes: [], checks: [], routes: [], refreshes: 0, alerts: [] };
  const profile = { username: null, created_at: null, avatar_url: null, headline: null };
  let checkResult = () => ({ data: true, error: null });
  let writeResult = args => ({ data: { id: args.id, username: args.username }, error: null });
  const useState = initial => {
    const key = slot++;
    if (!(key in values)) values[key] = typeof initial === 'function' ? initial() : initial;
    return [values[key], value => { values[key] = typeof value === 'function' ? value(values[key]) : value; }];
  };
  const react = {
    useState,
    useRef: value => useState(() => ({ current: value }))[0],
    useEffect(fn, deps) {
      const key = slot++, previous = effects[key];
      if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) {
        queued.push(() => { previous?.cleanup?.(); effects[key] = { deps, cleanup: fn() }; });
      }
    },
  };
  react.useLayoutEffect=react.useEffect;
  react.useMemo=(fn,deps)=>{const i=slot++;const old=values[i];if(!old||deps.some((value,j)=>!Object.is(value,old.deps[j])))values[i]={value:fn(),deps};return values[i].value;};
  react.useCallback=(fn,deps)=>react.useMemo(()=>fn,deps);
  const user = () => viewer ? { id: viewer, email_confirmed_at: 'confirmed' } : null;
  const client = {
    auth: {
      getUser: async () => ({ data: { user: user() }, error: null }),
      getSession: async () => ({ data: { session: viewer ? { user: user() } : null } }),
    },
    rpc(_name, args) { calls.checks.push(args.p_username); return Promise.resolve(checkResult(args.p_username)); },
    from(table) {
      assert.equal(table, 'profiles');
      const args = {};
      const finish = () => {
        if (Object.hasOwn(args, 'username')) { calls.writes.push({ ...args }); return Promise.resolve(writeResult(args)); }
        return Promise.resolve({ data: { ...profile }, error: null });
      };
      const chain = {
        select(columns) { args.columns = columns; return chain; },
        update(update) { Object.assign(args, update); return chain; },
        eq(key, value) { args[key] = value; return chain; },
        single: finish, maybeSingle: finish,
        then(ok, bad) { return finish().then(ok, bad); },
      };
      return chain;
    },
  };
  const jsx = (type, props) => ({ type, props });
  const imports = {
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'next/navigation': { usePathname: () => '/home', useRouter: () => ({ push: href => calls.routes.push(href), replace: href => calls.routes.push(href), refresh: () => calls.refreshes++ }) },
    'next/link': { default: 'Link' },
    '@/lib/supabase/client': { createClient: () => client },
    '@/lib/useUnreadNotifications': { useUnreadNotifications: () => 0 },
    '@/lib/navigation': navigationModule.exports,
    './NavigationActions': { NAV_ICONS: new Proxy({}, { get: (_, key) => String(key) }), CreateMenu: 'CreateMenu', MoreMenu: 'MoreMenu' },
    '@/lib/useViewerIdentity': { useViewerIdentity: () => ({ viewer: user(), loading: false, error: '', retry() {} }) },
    '@/lib/withTimeout': { withTimeout: work => Promise.resolve(work) },
  };
  const resourceModules=new Map();
  function resource(file){
    if(resourceModules.has(file))return resourceModules.get(file);
    const exports={};resourceModules.set(file,exports);
    const code=ts.transpileModule(fs.readFileSync(path.join(root,'web',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    vm.runInNewContext(code,{exports,require:id=>{const target=path.posix.join(path.posix.dirname(file),id);return imports[id]??imports['@/'+target]??resource(target+'.ts');}});
    return exports;
  }
  imports['@/lib/useAccountResource']=resource('lib/useAccountResource.ts');
  const source = process.argv.includes('--baseline')
    ? execFileSync('git', ['show', baseline[file]], { cwd: root, encoding: 'utf8' })
    : fs.readFileSync(path.join(root, 'web', file), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, {
    module, exports: module.exports,
    require: id => imports[id] ?? new Proxy({}, { get: (_, key) => String(key) }),
    setTimeout(fn) { const id = ++timer; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
    alert: message => calls.alerts.push(message),
    window: { localStorage: { getItem: () => null }, scrollTo() {}, addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: true }) },
    document: { documentElement: { classList: { toggle() {}, remove() {} } }, addEventListener() {}, removeEventListener() {} },
  }, { filename: file });
  const render = () => {
    slot = 0;
    const tree = module.exports[name](props);
    while (queued.length) queued.shift()();
    return tree;
  };
  return {
    calls, profile, render,
    input: () => nodes(render()).find(n => n.type === 'input'),
    button: () => nodes(render()).find(n => n.type === 'button'),
    change(value) { this.input().props.onChange({ target: { value } }); return render(); },
    submit() { return this.button().props.onClick(); },
    setViewer(id) { viewer = id; },
    setCheck(fn) { checkResult = fn; }, setWrite(fn) { writeResult = fn; },
    async runTimers() {
      const pending = [...timers.values()]; timers.clear();
      const running = pending.map(fn => fn()); await flush(); return { running };
    },
    unmount() { effects.forEach(effect => effect?.cleanup?.()); },
  };
}

for (const username of ['', 'known_member']) {
  test(`desktop profile and avatar links route ${username || 'a new account'} correctly`, () => {
    const h = harness('components/Nav.tsx', 'Nav', { name: 'Musa Test', username });
    const tree = h.render();
    const links = nodes(tree).filter(n => n.type === 'Link');
    const destination = username ? '/known_member' : '/settings/username';
    assert.equal(links.find(n => text(n) === 'Profile').props.href, destination);
    assert.equal(links.find(n => n.props['aria-label'] === 'Your profile' || n.props.title === 'Musa Test').props.href, destination);
    assert.match(text(tree), username ? /@known_member/ : /Set (your )?username/);
  });
  test(`mobile account menu routes ${username || 'a new account'} correctly`, () => {
    const h = harness('components/TopBar.tsx', 'TopBar', { name: 'Musa Test', username });
    let tree = h.render();
    const popover = nodes(tree).find(n => n.type === 'NavigationPopover' && n.props.label === 'Account menu');
    if (popover) tree = popover.props.children(() => {});
    else { nodes(tree).find(n => n.props?.['aria-label'] === 'Account menu').props.onClick(); tree = h.render(); }
    const link = nodes(tree).find(n => n.type === 'Link' && text(n).includes('Your profile'));
    assert.equal(link.props.href, username ? '/known_member' : '/settings/username');
    assert.match(text(tree), username ? /@known_member/ : /Set username|Your Platinum Circles account/);
  });
}

test('profile completion links lead to the editor for the missing field', async () => {
  const h = harness('components/AccountStatus.tsx', 'AccountStatus');
  h.render(); await flush();
  for (const [label, destination] of [['Username set', '/settings/username'], ['Profile photo', '/settings/profile'], ['Headline written', '/settings/profile']]) {
    assert.equal(nodes(h.render()).find(n => n.type === 'Link' && text(n).includes(label)).props.href, destination);
  }
});

async function ready() {
  const h = harness('app/settings/username/page.tsx');
  h.render(); await flush();
  return h;
}
async function available(h, handle = 'chosen_name') {
  h.change(handle); await h.runTimers();
  assert.equal(h.button().props.disabled, false);
}

test('an old availability result cannot enable a newer invalid handle', async () => {
  const h = await ready(), old = deferred();
  h.setCheck(() => old.promise); h.change('earlier'); await h.runTimers();
  h.change('!'); old.resolve({ data: true, error: null }); await flush();
  assert.equal(h.button().props.disabled, true);
  await h.submit(); assert.equal(h.calls.writes.length, 0);
});

test('returning to the same text does not revive a superseded availability check', async () => {
  const h = await ready(), old = deferred(); let checks = 0;
  h.setCheck(() => ++checks === 1 ? old.promise : { data: false, error: null });
  h.change('earlier'); await h.runTimers(); h.change('later'); h.change('earlier'); await h.runTimers();
  old.resolve({ data: true, error: null }); await flush();
  assert.equal(h.button().props.disabled, true); assert.match(text(h.render()), /taken/);
});

for (const thrown of [false, true]) {
  test(`availability ${thrown ? 'exception' : 'returned error'} remains retryable without claiming taken`, async () => {
    const h = await ready();
    h.setCheck(() => { if (thrown) throw new Error('offline'); return { data: null, error: { message: 'offline' } }; });
    h.change('chosen_name'); await h.runTimers();
    assert.equal(h.button().props.disabled, true);
    assert.match(text(h.render()), /Could not check availability/);
    h.setCheck(() => ({ data: true, error: null })); await available(h, 'chosen_other');
  });
}

test('saving confirms the updated row and refreshes account navigation', async () => {
  const h = await ready(); await available(h);
  await h.submit();
  assert.deepEqual(h.calls.writes, [{ username: 'chosen_name', id: 'viewer-a', columns: 'id, username' }]);
  assert.deepEqual(h.calls.routes, ['/chosen_name']); assert.equal(h.calls.refreshes, 1);
  assert.equal(h.calls.alerts.length, 0); assert.equal(h.button().props.disabled, true);
});

for (const viewer of [null, 'viewer-b']) {
  test(`saving refuses ${viewer ? 'a different signed-in account' : 'a signed-out account'}`, async () => {
    const h = await ready(); await available(h); h.setViewer(viewer);
    await h.submit();
    assert.equal(h.calls.writes.length, 0); assert.equal(h.calls.routes.length, 0);
    assert.equal(h.calls.alerts.length, 1); assert.equal(h.button().props.disabled, false);
  });
}

test('an update affecting no profile does not claim success or navigate', async () => {
  const h = await ready(); await available(h); h.setWrite(() => ({ data: null, error: null }));
  await h.submit();
  assert.equal(h.calls.routes.length, 0); assert.equal(h.calls.refreshes, 0);
  assert.match(h.calls.alerts[0], /not saved/); assert.equal(h.button().props.disabled, false);
});

test('an update exception releases the save control for recovery', async () => {
  const h = await ready(); await available(h); h.setWrite(() => { throw new Error('offline'); });
  await h.submit();
  assert.equal(h.calls.routes.length, 0); assert.match(h.calls.alerts[0], /offline/);
  assert.equal(h.button().props.disabled, false);
});

test('rapid duplicate saves and edits during a save do not create extra writes', async () => {
  const h = await ready(); await available(h); const result = deferred(); h.setWrite(() => result.promise);
  const save = h.button().props.onClick;
  const first = save(), second = save(); await flush();
  assert.equal(h.input().props.disabled, true); h.change('changed_during_save');
  assert.equal(h.input().props.value, 'chosen_name'); assert.equal(h.calls.writes.length, 1);
  result.resolve({ data: { id: 'viewer-a', username: 'chosen_name' }, error: null });
  await Promise.all([first, second]); assert.deepEqual(h.calls.routes, ['/chosen_name']);
});

test('leaving the username page prevents a late availability result from enabling save', async () => {
  const h = await ready(), old = deferred();
  h.setCheck(() => old.promise); h.change('earlier'); await h.runTimers(); h.unmount();
  old.resolve({ data: true, error: null }); await flush();
  assert.equal(h.button().props.disabled, true);
});
