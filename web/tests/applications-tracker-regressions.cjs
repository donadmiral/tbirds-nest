const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

// Run the real recruiter handlers with controlled RPC responses. No hosted writes.
const source = fs.readFileSync(process.env.APPLICATIONS_SOURCE || path.join(__dirname, '../app/jobs/applications/page.tsx'), 'utf8');
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
const application = (id, extra={}) => ({id,job_id: 'job-'+id,status:'applied',applied_at:'2026-01-01T00:00:00Z', ...extra});
function harness({read = async table => ({data: [], error: null}), sessionError = null, user='one'} = {}) {
  let authCallback;
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
  const client = {
    auth: {
      getSession: async () => ({data:{session:user ? {user:{id:user}} : null}, error:sessionError}),
      onAuthStateChange: callback => {authCallback=callback; return {data:{subscription:{unsubscribe(){authCallback=null;}}}};},
    },
    from(table) {
      const call={table, filters:[], range:null}; calls.push(call);
      const query={select:()=>query, eq:(...args)=>{call.filters.push(args);return query;},order:()=>query,
        in:(...args)=>{call.ids=args;return query;},range:(...args)=>{call.range=args;return query;},
        then:(resolve,reject)=>Promise.resolve().then(()=>read(table,call)).then(resolve,reject)};
      return query;
    },
  };
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
      if (id === '@/lib/jobs') return {STATUS_META: {applied:{label:'Applied'}, interview:{label:'Interview'}, rejected:{label:'Rejected'}}, APPLICATION_STATUS_ORDER:['applied','interview','rejected']};
      if (id === '@/lib/feed') return {timeAgo: date => date};
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
  return { render, flush, find, click, unmount, error, calls, routes, nodes, setUser(next) {user=next; authCallback?.("SIGNED_IN", next ? {user:{id:next}} : null);}, get text() { return text(tree); }, get stateWrites() { return stateWrites; } };
}



test('failed application read is not an empty history and retry succeeds', async () => {
  let fail=true;
  const app=harness({read:async table=>table==='job_applications' && fail ? {data:null,error:{message:'offline'}} : {data:table==='job_applications'?[application('one')]:[{id:'job-one',title:'Role one',company:'Company',location:'Remote'}],error:null}});
  app.render();await app.flush();
  assert.ok(app.text.includes('Applications could not be loaded'));
  assert.equal(app.text.includes('Roles you apply for show up here'),false);
  fail=false;app.click('Retry');await app.flush();
  assert.ok(app.text.includes('Role one'));assert.ok(app.text.includes('Company · Remote'));
});

test('job detail failure preserves confirmed rows and retries the failed refresh', async()=>{
  let fail=false;
  const app=harness({read:async table=>({data:table==='job_applications'?[application('one')]:[{id:'job-one',title:'Role one'}],error:table==='jobs'&&fail?{message:'offline'}:null})});
  app.render();await app.flush();fail=true;app.click('Refresh');await app.flush();
  assert.ok(app.text.includes('Role one'));assert.ok(app.text.includes('Applications could not be loaded'));
  fail=false;app.click('Retry');await app.flush();
  const reads=app.calls.filter(c=>c.table==='job_applications');
  assert.deepEqual(reads.map(c=>c.range),[[0,50],[0,50],[0,50]]);
});

test('status filter is server-side and late responses cannot overwrite it',async()=>{
  const pending=deferred();let count=0;
  const app=harness({read:async(table,call)=>{
    if(table==='jobs')return{data:[],error:null};
    if(count++===0)return pending.promise;
    assert.ok(call.filters.some(([k,v])=>k==='status'&&v==='rejected'));
    return{data:[application('new',{status:'rejected'})],error:null};
  }});
  app.render();await app.flush();app.find(n=>n.type==='select').props.onChange({target:{value:'rejected'}});app.render();await app.flush();
  pending.resolve({data:[application('old')],error:null});await app.flush();
  const links=app.nodes().filter(n=>n.type==='Link').map(n=>n.props.href);
  assert.ok(links.includes('/jobs/job-new'));assert.equal(links.includes('/jobs/job-old'),false);
});

test('more than 50 applications load in bounded pages without dropping the sentinel row',async()=>{
  const rows=Array.from({length:52},(_,i)=>application(String(i)));
  const app=harness({read:async(table,call)=>({data:table==='job_applications'?rows.slice(call.range[0],call.range[1]+1):[],error:null})});
  app.render();await app.flush();assert.equal(app.nodes().filter(n=>n.type==='Link'&&n.props.href.startsWith('/jobs/job-')).length,50);
  app.click('Load more');await app.flush();assert.equal(app.nodes().filter(n=>n.type==='Link'&&n.props.href.startsWith('/jobs/job-')).length,52);
  assert.equal(app.text.includes('Load more'),false);
  assert.deepEqual(app.calls.filter(c=>c.table==='job_applications').map(c=>c.range),[[0,50],[50,100]]);
});

test('account changes immediately clear rows and discard the previous account response',async()=>{
  const pending=deferred();let first=true;
  const app=harness({read:async(table,call)=>{
    if(table==='jobs')return{data:[],error:null};
    if(first){first=false;return pending.promise;}
    assert.ok(call.filters.some(([k,v])=>k==='applicant_id'&&v==='two'));
    return{data:[application('two')],error:null};
  }});
  app.render();await app.flush();app.setUser('two');app.render();await app.flush();
  pending.resolve({data:[application('one')],error:null});await app.flush();
  assert.equal(app.nodes().some(n=>n.props?.href==='/jobs/job-one'),false);
  assert.ok(app.nodes().some(n=>n.props?.href==='/jobs/job-two'));
  app.setUser(null);app.render();await app.flush();assert.ok(app.text.includes('Sign in'));assert.equal(app.text.includes('Job no longer available'),false);
});

test('missing dates are truthful and interview details come from application data',async()=>{
  const app=harness({read:async table=>({data:table==='job_applications'?[application('one',{status:'interview',applied_at:null,interview_at:'2027-01-01T12:00:00Z',interview_location:'Office'})]:[],error:null})});
  app.render();await app.flush();assert.ok(app.text.includes('Date unavailable'));assert.ok(app.text.includes('Office'));assert.ok(app.text.includes('Job no longer available'));
});

test('unmount cancels queued account loads',async()=>{
  const app=harness();app.render();await app.flush();app.setUser('two');app.unmount();const before=app.stateWrites;await app.flush();assert.equal(app.stateWrites,before);
});
