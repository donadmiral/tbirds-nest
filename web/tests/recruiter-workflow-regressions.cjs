const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

// Run the real recruiter handlers with controlled RPC responses. No hosted writes.
const source = fs.readFileSync(process.env.RECRUITER_SOURCE || path.join(__dirname, '../app/studio/recruiter/page.tsx'), 'utf8');
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
const job = id => ({ id, title: 'Job ' + id, company: 'Company', closed: false, created_at: '2026-01-01T00:00:00Z', counts: {total: 1, interview: 0, hired: 0} });
const applicant = (id, status = 'applied', extra = {}) => ({ id, name: 'Applicant ' + id, applicant_id: 'user-' + id, status, tags: [], notes: [], applied_at: '2026-01-01T00:00:00Z', ...extra });
function loadHelper() {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/recruiting.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, Date });
  return module.exports;
}
const helper = loadHelper();
function harness({ rpc = async name => ({data: name === 'studio_jobs' ? [job('A'), job('B')] : [applicant('A')], error: null}) } = {}) {
  const slots = [], effects = [], calls = [], routes = [];
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
  const client = { rpc: (name, args) => { calls.push({ name, args }); return rpc(name, args); } };
  const runtime = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'Fragment' };
  const moduleObject = { exports: {} };
  const stubs = new Proxy({}, { get: (_, key) => String(key) });
  vm.runInNewContext(compiled, {
    exports: moduleObject.exports, module: moduleObject, console, queueMicrotask, alert() {}, confirm: () => true,
    require(id) {
      if (id === 'react') return hooks;
      if (id === 'react/jsx-runtime') return runtime;
      if (id === '@/lib/supabase/client') return { createClient: () => client };
      if (id === '@/components/StudioShell') return { useStudio: () => ({ me: { role: 'owner' } }) };
      if (id === '@/lib/studio') return { can: () => true };
      if (id === '@/lib/recruiting') return helper;
      if (id === 'next/navigation') return {useRouter: () => ({push: path => routes.push(path)})};
      if (id.endsWith('/LoadError')) return { StudioLoadError: 'StudioLoadError' };
      if (id === 'next/link') return { __esModule: true, default: 'Link' };
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
  const flush = async () => { for (let i = 0; i < 5; i++) { await new Promise(resolve => setImmediate(resolve)); render(); } };
  const unmount = () => slots.filter(s => s?.effect).forEach(s => s.cleanup?.());
  const error = word => find(n => n.type === 'StudioLoadError' && n.props.message?.startsWith(word));
  return { render, flush, find, click, unmount, error, calls, routes, nodes, get text() { return text(tree); }, get stateWrites() { return stateWrites; } };
}


test('job failures show retry without inventing an empty company', async () => {
  let fail = true;
  const app = harness({rpc: async name => {
    if (name === 'studio_jobs' && fail) throw new Error('offline');
    return {data: name === 'studio_jobs' ? [job('A')] : [], error: null};
  }});
  app.render(); await app.flush();
  assert.ok(app.error('Jobs'));
  assert.equal(app.text.includes('No jobs posted yet'), false);
  fail = false; app.error('Jobs').props.retry(); await app.flush();
  assert.equal(app.error('Jobs'), undefined);
  assert.ok(app.text.includes('Job A'));
  assert.equal(app.find(n => n.type === 'Link' && text(n).includes('Post a job')).props.href, '/jobs/new');
  assert.equal(app.find(n => n.type === 'Link' && text(n) === 'View listing').props.href, '/jobs/A');
});

test('applicant failure is distinct from empty and can recover', async () => {
  let fail = true;
  const app = harness({rpc: async name => name === 'studio_jobs' ? {data: [job('A')], error: null}
    : fail ? {data: null, error: {message: 'offline'}} : {data: [applicant('one')], error: null}});
  app.render(); await app.flush();
  assert.ok(app.error('Applicants'));
  assert.equal(app.text.includes('Nobody at this stage'), false);
  fail = false; app.error('Applicants').props.retry(); await app.flush();
  assert.ok(app.text.includes('Applicant one'));
});

test('switching jobs rejects stale applicant responses including A to B to A', async () => {
  const first = deferred(); let aReads = 0;
  const app = harness({rpc: async (name, args) => {
    if (name === 'studio_jobs') return {data: [job('A'), job('B')], error: null};
    if (args.p_job === 'A' && aReads++ === 0) return first.promise;
    return {data: [applicant('Fresh ' + args.p_job)], error: null};
  }});
  app.render(); await app.flush();
  app.find(n => n.type === 'button' && text(n).startsWith(' Job B')).props.onClick(); app.render(); await app.flush();
  app.find(n => n.type === 'button' && text(n).startsWith(' Job A')).props.onClick(); app.render(); await app.flush();
  first.resolve({data: [applicant('Stale A')], error: null}); await app.flush();
  assert.ok(app.text.includes('Fresh A'));
  assert.equal(app.text.includes('Stale A'), false);
  const same = app.find(n => n.type === 'button' && text(n).startsWith(' Job A')); same.props.onClick(); app.render(); await app.flush();
  assert.ok(app.text.includes('Fresh A'), 'reselecting current job must not clear applicants');
});

test('withdrawn and future statuses stay visible and withdrawn applications cannot advance', async () => {
  const app = harness({rpc: async name => ({data: name === 'studio_jobs' ? [job('A')] : [applicant('Withdrawn', 'withdrawn'), applicant('Future', 'future')], error: null})});
  app.render(); await app.flush();
  assert.ok(app.text.includes('Applicant Future'));
  app.find(n => n.type === 'button' && text(n).includes('Applicant Withdrawn')).props.onClick(); app.render();
  for (const label of ['New', 'Screening', 'Interview', 'Offer', 'Hired', 'Rejected']) {
    const button = app.find(n => n.type === 'button' && text(n) === label); assert.equal(button.props.disabled, true);
    button.props.onClick();
  }
  assert.equal(app.calls.some(c => c.name === 'studio_set_stage'), false);
});

test('both message controls target the returned jobs conversation and lock repeated clicks', async () => {
  const pending = deferred();
  const app = harness({rpc: async name => name === 'start_dm_ctx' ? pending.promise : ({data: name === 'studio_jobs' ? [job('A')] : [applicant('one')], error: null})});
  app.render(); await app.flush(); app.find(n => n.type === 'button' && text(n).includes('Applicant one')).props.onClick(); app.render();
  const buttons = app.nodes().filter(n => n.type === 'button' && text(n).trim() === 'Message');
  assert.equal(buttons.length, 2); buttons[0].props.onClick(); buttons[1].props.onClick();
  assert.equal(app.calls.filter(c => c.name === 'start_dm_ctx').length, 1);
  pending.resolve({data: 'conversation-one', error: null}); await app.flush();
  assert.deepEqual(app.routes, ['/jobs/messages?c=conversation-one']);
  const call = app.calls.find(c => c.name === 'start_dm_ctx');
  assert.deepEqual({...call.args}, {p_receiver_id: 'user-one', p_context: 'jobs', p_ref_id: 'A'});
});

test('late messages never redirect another selection', async () => {
  const pending = deferred();
  const app = harness({rpc: async name => name === 'start_dm_ctx' ? pending.promise : ({data: name === 'studio_jobs' ? [job('A')] : [applicant('one'), applicant('two')], error: null})});
  app.render(); await app.flush(); app.find(n => n.type === 'button' && text(n).includes('Applicant one')).props.onClick(); app.render();
  app.find(n => n.type === 'button' && text(n).trim() === 'Message').props.onClick();
  app.find(n => n.type === 'button' && text(n).includes('Applicant two')).props.onClick(); app.render();
  pending.resolve({data: 'old-conversation', error: null}); await app.flush();
  assert.deepEqual(app.routes, []);
});

test('interviews reject invalid and past dates without sending a mutation', async () => {
  const app = harness(); app.render(); await app.flush();
  app.find(n => n.type === 'button' && text(n).includes('Applicant A')).props.onClick(); app.render();
  for (const value of ['not-a-date', '2020-01-01T12:00']) {
    app.find(n => n.props?.['aria-label'] === 'Interview date and time').props.onChange({target: {value}}); app.render();
    app.find(n => n.type === 'button' && text(n) === 'Schedule and notify').props.onClick(); app.render();
    assert.ok(app.error('Choose a future'));
  }
  assert.equal(app.calls.some(c => c.name === 'studio_schedule_interview'), false);
});

test('draft notes reset on selection and a late save cannot erase another applicant draft', async () => {
  const pending = deferred();
  const app = harness({rpc: async name => name === 'studio_add_note' ? pending.promise : ({data: name === 'studio_jobs' ? [job('A')] : [applicant('one'), applicant('two')], error: null})});
  app.render(); await app.flush(); app.find(n => n.type === 'button' && text(n).includes('Applicant one')).props.onClick(); app.render();
  app.find(n => n.props?.['aria-label'] === 'Team note').props.onChange({target: {value: 'For one'}}); app.render(); app.click('Add');
  app.find(n => n.type === 'button' && text(n).includes('Applicant two')).props.onClick(); app.render();
  assert.equal(app.find(n => n.props?.['aria-label'] === 'Team note').props.value, '');
  app.find(n => n.props?.['aria-label'] === 'Team note').props.onChange({target: {value: 'For two'}}); app.render();
  pending.resolve({data: null, error: null}); await app.flush();
  assert.equal(app.find(n => n.props?.['aria-label'] === 'Team note').props.value, 'For two');
});

test('unmounted recruiter ignores pending responses', async () => {
  const pending = deferred(); const app = harness({rpc: () => pending.promise}); app.render(); app.unmount();
  const before = app.stateWrites; pending.resolve({data: [job('A')], error: null}); await app.flush();
  assert.equal(app.stateWrites, before);
});

test('summary counts every applicant exactly once and does not infer historical stages', () => {
  const summary = helper.recruitingSummary(['applied', 'viewed', 'shortlisted', 'hired', 'accepted', 'rejected', 'withdrawn', 'future'].map(status => ({status})));
  assert.equal(summary.total, 8); assert.equal(summary.hired, 2); assert.equal(summary.rate, 25);
  assert.equal(summary.counts.applied, 2); assert.equal(summary.counts.interview, 0); assert.equal(summary.counts.withdrawn, 1);
  assert.equal(Object.values(summary.counts).reduce((a,b) => a+b, 0), 8);
  assert.equal(helper.interviewLocalInput('invalid'), '');
});

for (const outcome of ['error', 'missing', 'thrown']) test(`message ${outcome} outcome shows a retryable error without redirecting`, async () => {
  const app = harness({rpc: async name => {
    if (name !== 'start_dm_ctx') return {data: name === 'studio_jobs' ? [job('A')] : [applicant('one')], error: null};
    if (outcome === 'thrown') throw new Error('offline');
    return {data: null, error: outcome === 'error' ? {message:'offline'} : null};
  }});
  app.render(); await app.flush(); app.find(n => n.type === 'button' && text(n).includes('Applicant one')).props.onClick(); app.render();
  app.find(n => n.type === 'button' && text(n).trim() === 'Message').props.onClick(); await app.flush();
  assert.ok(app.error('The conversation')); assert.deepEqual(app.routes, []);
  assert.equal(app.find(n => n.type === 'button' && text(n).trim() === 'Message').props.disabled, false);
});
