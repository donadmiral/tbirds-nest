const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '../..');
const compile = (file) => ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
  fileName: file,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
const errors = { exports: {} };
vm.runInNewContext(compile('web/lib/errors.ts'), { module: errors, exports: errors.exports, Error });
const component = compile('web/app/jobs/saved/page.tsx');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const jsx = (type, props, key) => ({ type, props, key });
const walk = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(walk) : [tree, ...walk(tree.props?.children)];
const text = tree => typeof tree === 'string' || typeof tree === 'number' ? String(tree)
  : Array.isArray(tree) ? tree.map(text).join('') : text(tree?.props?.children ?? '');
const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));

function harness(read = async table => ({ data: table === 'job_saves' ? [{ job_id: 'saved' }] : [{ id: 'saved', title: 'Saved role' }], error: null })) {
  const slots = [], effects = [], reads = [];
  let cursor = 0, tree, user = 'owner', auth, writes = 0;
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], next => { writes++; slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!same(slots[i]?.deps, deps)) effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, effect: fn, cleanup: fn() }; });
    },
  };
  const client = {
    auth: {
      getSession: async () => ({ data: { session: user ? { user: { id: user } } : null }, error: null }),
      onAuthStateChange(callback) { auth = callback; return { data: { subscription: { unsubscribe() { if (auth === callback) auth = null; } } } }; },
    },
    from(table) {
      const request = { table, user, filters: [] };
      const query = { select() { return query; }, eq(...args) { request.filters.push(args); return query; }, in(...args) { request.filters.push(args); return query; }, order() { return query; },
        then(resolve, reject) { reads.push(request); return Promise.resolve().then(() => read(table, request)).then(resolve, reject); } };
      return query;
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(component, {
    module, exports: module.exports, Error, console,
    require(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === '@/lib/supabase/client') return { createClient: () => client };
      if (name === '@/lib/errors') return errors.exports;
      if (name === '@/components/JobCard') return { JobCard: 'JobCard' };
      if (name === 'next/link') return { __esModule: true, default: 'Link' };
      if (name.endsWith('.module.css')) return { __esModule: true, default: {} };
      if (name === 'lucide-react') return {};
      throw Error('Unexpected dependency ' + name);
    },
  });
  const render = () => { cursor = 0; tree = module.exports.default(); effects.splice(0).forEach(fn => fn()); return tree; };
  const nodes = () => walk(tree);
  const flush = async () => { for (let i = 0; i < 5; i++) { await tick(); render(); } };
  return {
    render, flush, reads, nodes,
    get jobs() { return nodes().filter(node => node.type === 'JobCard').map(node => node.props.job.id); },
    get text() { return text(tree); }, get writes() { return writes; },
    click(label) { const button = nodes().find(node => node.type === 'button' && text(node) === label); assert.ok(button, label); button.props.onClick(); render(); },
    // A retained route's effects restart when its activity resumes. React
    // preserves its state, while the real component revalidates its reads.
    resume() { for (const slot of slots) if (slot?.effect) { slot.cleanup?.(); slot.cleanup = slot.effect(); } render(); },
    setUser(next) { user = next; auth?.(next ? 'SIGNED_IN' : 'SIGNED_OUT', next ? { user: { id: next } } : null); render(); },
    dispose() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

test('resuming saved jobs keeps cards visible while fresh rows load', async () => {
  const gate = deferred(); let jobs = 0;
  const h = harness(async table => table === 'job_saves' ? { data: [{ job_id: 'saved' }], error: null }
    : ++jobs === 1 ? { data: [{ id: 'saved' }], error: null } : gate.promise);
  h.render(); await h.flush(); assert.deepEqual(h.jobs, ['saved']);
  h.resume(); await h.flush(); assert.deepEqual(h.jobs, ['saved']); assert.equal(h.text.includes('Loading saved jobs'), false);
  gate.resolve({ data: [{ id: 'fresh' }], error: null }); await h.flush(); assert.deepEqual(h.jobs, ['fresh']); h.dispose();
});

test('a transient saved-jobs failure shows retry beside the retained list', async () => {
  const gate = deferred(); let jobs = 0;
  const h = harness(async table => table === 'job_saves' ? { data: [{ job_id: 'saved' }], error: null }
    : ++jobs === 1 ? { data: [{ id: 'saved' }], error: null } : jobs === 2 ? { data: null, error: { message: 'Offline', code: 'NETWORK_ERROR' } } : gate.promise);
  h.render(); await h.flush(); h.resume(); await h.flush();
  assert.deepEqual(h.jobs, ['saved']); assert.ok(h.nodes().some(node => node.props?.role === 'alert')); assert.equal(h.text.includes('No saved jobs yet'), false);
  h.click('Try again'); await h.flush(); assert.deepEqual(h.jobs, ['saved']); assert.equal(h.text.includes('Loading saved jobs'), false);
  gate.resolve({ data: [], error: null }); await h.flush(); assert.deepEqual(h.jobs, []); assert.ok(h.text.includes('No saved jobs yet')); h.dispose();
});

for (const denial of [{ code: '42501', message: 'Denied' }, { status: 403, message: 'Denied' }]) test('saved-job access loss removes retained private results: ' + JSON.stringify(denial), async () => {
  let jobs = 0;
  const h = harness(async table => table === 'job_saves' ? { data: [{ job_id: 'saved' }], error: null }
    : ++jobs === 1 ? { data: [{ id: 'saved' }], error: null } : { data: null, error: denial });
  h.render(); await h.flush(); h.resume(); await h.flush();
  assert.deepEqual(h.jobs, []); assert.ok(h.nodes().some(node => node.props?.role === 'alert')); assert.equal(h.text.includes('No saved jobs yet'), false); h.dispose();
});

test('an authoritative empty saves list clears old jobs, while malformed data stays retryable', async () => {
  let saves = 0;
  const h = harness(async table => ({ data: table === 'job_saves' ? ++saves === 1 ? [{ job_id: 'saved' }] : saves === 2 ? null : [] : [{ id: 'saved' }], error: null }));
  h.render(); await h.flush(); h.resume(); await h.flush(); assert.deepEqual(h.jobs, ['saved']);
  assert.ok(h.nodes().some(node => node.props?.role === 'alert'));
  h.click('Try again'); await h.flush(); assert.deepEqual(h.jobs, []); assert.ok(h.text.includes('No saved jobs yet')); h.dispose();
});

test('account switches discard old reads and late unsave callbacks before rendering another shortlist', async () => {
  const gate = deferred(); let jobs = 0;
  const h = harness(async (table, request) => table === 'job_saves' ? { data: [{ job_id: 'same-job' }], error: null }
    : request.user === 'owner' && ++jobs > 1 ? gate.promise : { data: [{ id: 'same-job', title: request.user }], error: null });
  h.render(); await h.flush();
  const old = h.nodes().find(node => node.type === 'JobCard').props.onSavedChange;
  h.resume(); await h.flush(); h.setUser('other'); assert.deepEqual(h.jobs, []); await h.flush(); assert.deepEqual(h.jobs, ['same-job']);
  old(false); h.render(); assert.deepEqual(h.jobs, ['same-job']);
  gate.resolve({ data: [{ id: 'stale-private' }], error: null }); await h.flush(); assert.deepEqual(h.jobs, ['same-job']);
  h.setUser(null); assert.deepEqual(h.jobs, []); await h.flush(); assert.ok(h.text.includes('Sign in to save roles')); h.dispose();
});

test('same-account auth notifications keep the mounted list and do not repeat reads', async () => {
  const h = harness(); h.render(); await h.flush(); const count = h.reads.length;
  h.setUser('owner'); await h.flush(); assert.deepEqual(h.jobs, ['saved']); assert.equal(h.reads.length, count); h.dispose();
});
