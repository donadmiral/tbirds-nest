const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === 'object' ? [value, ...nodes(value.props?.children)] : [];
const text = value => Array.isArray(value) ? value.map(text).join('') : typeof value === 'string' || typeof value === 'number' ? String(value) : text(value?.props?.children ?? '');

// Runs the real account hooks and component handlers. Key changes perform the
// child's cleanup before mounting its replacement, matching React's lifetime.
function accountHarness({ owner = 'account-a', factors = [] } = {}) {
  let cursor = 0, dirty = false, tree, component, childKey, childStart, alive = true, sequence = 0;
  const slots = [], effects = [], authListeners = new Set(), timers = new Map(), calls = [];
  const modules = new Map(), overrides = new Map();
  let factorRows = [...factors], sessionError = null, userRead = null, prompt = '123456';
  const equal = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hooks = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], next => { if (!alive) return; const value = typeof next === 'function' ? next(slots[i]) : next; if (!Object.is(value, slots[i])) { slots[i] = value; dirty = true; } }];
    },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useMemo(factory, deps) { const i = cursor++; if (!equal(slots[i]?.deps, deps)) slots[i] = { deps, value: factory() }; return slots[i].value; },
    useCallback(fn, deps) { return hooks.useMemo(() => fn, deps); },
    useEffect(fn, deps) {
      const i = cursor++, old = slots[i];
      if (equal(old?.deps, deps)) return;
      const record = { deps }; slots[i] = record;
      effects.push(() => { old?.cleanup?.(); record.cleanup = fn(); });
    },
    useLayoutEffect(fn, deps) { return hooks.useEffect(fn, deps); },
  };
  const run = async (name, args, fallback) => { calls.push({ name, args }); return overrides.has(name) ? overrides.get(name)(args) : fallback(); };
  const client = { auth: {
    getSession: async () => ({ data: { session: owner ? { user: { id: owner } } : null }, error: sessionError }),
    getUser: () => userRead ? userRead() : Promise.resolve({ data: { user: owner ? { id: owner } : null }, error: null }),
    onAuthStateChange(fn) { authListeners.add(fn); return { data: { subscription: { unsubscribe() { authListeners.delete(fn); } } } }; },
    mfa: {
      listFactors: () => run('listFactors', undefined, () => ({ data: { totp: [...factorRows] }, error: null })),
      enroll: args => run('enroll', args, () => { const id = 'factor-' + ++sequence; factorRows.push({ id, status: 'unverified', friendly_name: args.friendlyName }); return { data: { id, totp: { qr_code: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg"/>', secret: 'LOCAL-TEST-SECRET' } }, error: null }; }),
      challenge: args => run('challenge', args, () => ({ data: { id: 'challenge-' + ++sequence }, error: null })),
      verify: args => run('verify', args, () => { factorRows = factorRows.map(f => f.id === args.factorId ? { ...f, status: 'verified' } : f); return { data: {}, error: null }; }),
      unenroll: args => run('unenroll', args, () => { factorRows = factorRows.filter(f => f.id !== args.factorId); return { data: {}, error: null }; }),
    },
  } };
  const imports = {
    react: hooks,
    'react/jsx-runtime': { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) },
    'next/image': { default: 'img' },
    'lucide-react': { ShieldCheck: 'ShieldCheck' },
    '@/components/ErrorState': { ErrorState: 'ErrorState' },
    '@/lib/supabase/client': { createClient: () => client },
  };
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} }; modules.set(file, module);
    const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    vm.runInNewContext(source, { module, exports: module.exports, Error, console, window: { prompt: () => prompt },
      setTimeout(fn) { const id = ++sequence; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
      require(name) {
        const alias = name === './supabase/client' ? '@/lib/supabase/client' : name;
        if (alias in imports) return imports[alias];
        const target = name.startsWith('@/') ? name.slice(2) : name.startsWith('./') ? path.posix.join(path.posix.dirname(file), name) : null;
        if (target) return load(target + '.ts');
        throw Error('Unexpected import ' + name);
      },
    });
    return module.exports;
  }
  const render = () => {
    let rounds = 0;
    do {
      dirty = false; cursor = 0; tree = component();
      if (typeof tree?.type === 'function') {
        if (childKey !== tree.key) {
          if (childStart !== undefined) { slots.slice(childStart).forEach(s => s?.cleanup?.()); slots.length = childStart; }
          childStart = cursor; childKey = tree.key;
        }
        while (typeof tree?.type === 'function') tree = tree.type(tree.props);
      } else if (childStart !== undefined) {
        slots.slice(childStart).forEach(s => s?.cleanup?.()); slots.length = childStart; childStart = undefined; childKey = undefined;
      }
      while (effects.length) effects.shift()();
      assert.ok(++rounds < 30, 'account screen settles');
    } while (dirty);
    return tree;
  };
  return {
    client, calls, hooks, load,
    mount(fn) { component = fn; return render(); }, render,
    async flush() { for (let i = 0; i < 8; i++) { await new Promise(setImmediate); render(); } },
    auth(next, event = 'SIGNED_IN') { owner = next; for (const fn of [...authListeners]) fn(event, next ? { user: { id: next } } : null); render(); },
    override(name, fn) { if (fn) overrides.set(name, fn); else overrides.delete(name); },
    set userRead(fn) { userRead = fn; }, set sessionError(error) { sessionError = error; }, set prompt(value) { prompt = value; },
    expire() { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } },
    button(label) { return nodes(render()).find(n => n.type === 'button' && text(n).trim() === label); },
    input(label, value) { const input = nodes(render()).find(n => n.type === 'input' && n.props['aria-label'] === label); assert.ok(input, label); input.props.onChange({ target: { value } }); render(); },
    get nodes() { return nodes(render()); }, get text() { return text(render()); },
    dispose() { alive = false; slots.forEach(s => s?.cleanup?.()); },
  };
}
module.exports = { accountHarness };
