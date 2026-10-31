const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

// Run the real applicant handlers and shared RPC client. No hosted writes.
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
const application = (id, extra={}) => ({id,job_id: 'job-'+id,status:'applied',applied_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-01T00:00:00Z', ...extra});
const uuid = value => `00000000-0000-4000-8000-${String(value).padStart(12,'0')}`;
const page = (applications=[],hasMore=false) => ({data:{applications,has_more:hasMore,cursor:hasMore?{id:applications.at(-1).id,applied_at:applications.at(-1).applied_at}:null},error:null});
function hiringClient() {
  const moduleObject={exports:{}};
  const source=fs.readFileSync(path.join(__dirname,'../../shared/hiring.ts'),'utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  vm.runInNewContext(compiled,{exports:moduleObject.exports,module:moduleObject});
  return moduleObject.exports;
}
const hiring = hiringClient();
function harness({read = async () => page(), sessionError = null, user='one'} = {}) {
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
    rpc(name,args) {
      const call={name,args,user}; calls.push(call);
      return Promise.resolve().then(()=>read(name,call));
    },
  };
  const element = (type, props) => ({ type, props: type === 'ProductDialog' && !props.open ? { ...props, children: null } : props });
  const runtime = { jsx: element, jsxs: element, Fragment: 'Fragment' };
  const moduleObject = { exports: {} };
  const stubs = new Proxy({}, { get: (_, key) => String(key) });
  vm.runInNewContext(compiled, {
    exports: moduleObject.exports, module: moduleObject, console, queueMicrotask, alert() {}, confirm: () => true,
    require(id) {
      if (id === 'react') return hooks;
      if (id === 'react/jsx-runtime') return runtime;
      if (id === '@/lib/supabase/client') return { createClient: () => client };
      if (id === '../../../../shared/hiring') return hiring;
      if (id === '@/components/StudioShell') return { useStudio: () => ({ me: { role: 'owner' } }) };
      if (id === '@/lib/studio') return { can: () => true };
      if (id === '@/lib/jobs') return {STATUS_META: {applied:{label:'Applied'}, interview:{label:'Interview'}, rejected:{label:'Rejected'}}, APPLICATION_STATUS_ORDER:['applied','interview','rejected']};
      if (id === '@/lib/feed') return {timeAgo: date => date};
      if (id === 'next/navigation') return {useRouter: () => ({push: path => routes.push(path)})};
      if (id.endsWith('/LoadError')) return { StudioLoadError: 'StudioLoadError' };
      if (id === '@/components/ProductDialog') return { ProductDialog: 'ProductDialog' };
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
  const app=harness({read:async name=>{
    assert.equal(name,'my_application_page');
    return fail ? {data:null,error:{message:'offline'}} : page([application('one',{job:{id:'job-one',title:'Role one',company:'Company',location:'Remote'}})]);
  }});
  app.render();await app.flush();
  assert.ok(app.text.includes('Applications could not be loaded'));
  assert.equal(app.text.includes('Roles you apply for show up here'),false);
  fail=false;app.click('Retry');await app.flush();
  assert.ok(app.text.includes('Role one'));assert.ok(app.text.includes('Company · Remote'));
});

test('joined job detail failure preserves confirmed rows and retries the failed refresh', async()=>{
  let fail=false;
  // Applications and job details now arrive in one atomic RPC response. A
  // failed join must preserve the previous successful page just like a failed
  // standalone job read did before the cursor API.
  const app=harness({read:async()=>fail ? {data:null,error:{message:'job join unavailable'}} : page([application('one',{job:{id:'job-one',title:'Role one'}})])});
  app.render();await app.flush();fail=true;app.click('Refresh');await app.flush();
  assert.ok(app.text.includes('Role one'));assert.ok(app.text.includes('Applications could not be loaded'));
  fail=false;app.click('Retry');await app.flush();
  const reads=app.calls.filter(c=>c.name==='my_application_page');
  assert.deepEqual(reads.map(c=>[c.args.p_before_at,c.args.p_before_id,c.args.p_limit]),[[null,null,25],[null,null,25],[null,null,25]]);
});

test('status filter is server-side and late responses cannot overwrite it',async()=>{
  const pending=deferred();let count=0;
  const app=harness({read:async(name,call)=>{
    assert.equal(name,'my_application_page');
    if(count++===0)return pending.promise;
    assert.equal(call.args.p_status,'rejected');
    return page([application('new',{status:'rejected'})]);
  }});
  app.render();await app.flush();app.find(n=>n.type==='select').props.onChange({target:{value:'rejected'}});app.render();await app.flush();
  pending.resolve(page([application('old')]));await app.flush();
  const links=app.nodes().filter(n=>n.type==='Link').map(n=>n.props.href);
  assert.ok(links.includes('/jobs/job-new'));assert.equal(links.includes('/jobs/job-old'),false);
});

test('more than 50 applications load in bounded pages without dropping the sentinel row',async()=>{
  const rows=Array.from({length:52},(_,i)=>application(uuid(i)));
  const app=harness({read:async(name,call)=>{
    assert.equal(name,'my_application_page');
    const start=call.args.p_before_id ? rows.findIndex(row=>row.id===call.args.p_before_id)+1 : 0;
    return page(rows.slice(start,start+call.args.p_limit),start+call.args.p_limit<rows.length);
  }});
  app.render();await app.flush();assert.equal(app.nodes().filter(n=>n.type==='article').length,25);
  app.click('Load more applications');await app.flush();assert.equal(app.nodes().filter(n=>n.type==='article').length,50);
  app.click('Load more applications');await app.flush();assert.equal(app.nodes().filter(n=>n.type==='article').length,52);
  assert.equal(app.text.includes('Load more'),false);
  assert.deepEqual(app.calls.map(c=>[c.args.p_before_id,c.args.p_limit]),[[null,25],[uuid(24),25],[uuid(49),25]]);
  const links=app.nodes().filter(n=>n.type==='Link'&&n.props.href.startsWith('/jobs/job-')).map(n=>n.props.href);
  assert.equal(new Set(links).size,52);
  for(const row of rows)assert.ok(links.includes('/jobs/'+row.job_id));
});

test('failed continuation preserves its cursor and loaded rows for retry',async()=>{
  const rows=Array.from({length:27},(_,i)=>application(uuid(i)));
  let fail=true;
  const app=harness({read:async(_name,call)=>{
    if(!call.args.p_before_id)return page(rows.slice(0,25),true);
    return fail ? {data:null,error:{message:'offline'}} : page(rows.slice(25));
  }});
  app.render();await app.flush();app.click('Load more applications');await app.flush();
  assert.equal(app.nodes().filter(n=>n.type==='article').length,25);
  assert.ok(app.text.includes('Applications could not be loaded'));
  fail=false;app.click('Retry');await app.flush();
  assert.equal(app.nodes().filter(n=>n.type==='article').length,27);
  assert.equal(app.calls[1].args.p_before_id,uuid(24));
  assert.equal(app.calls[2].args.p_before_id,uuid(24));
});

test('confirmed withdrawal sends fresh-state tokens once and an older refresh cannot restore applied status',async()=>{
  const original=application(uuid(1),{job:{id:'job-one',title:'Role one'}});
  const refresh=deferred(),withdraw=deferred();let reads=0;
  const app=harness({read:async(name)=>{
    if(name==='withdraw_job_application')return withdraw.promise;
    return reads++===0 ? page([original]) : refresh.promise;
  }});
  app.render();await app.flush();app.click('Refresh');await app.flush();
  app.click('Withdraw application');app.click('Confirm withdrawal');await app.flush();
  const calls=app.calls.filter(call=>call.name==='withdraw_job_application');
  assert.equal(calls.length,1);
  assert.equal(calls[0].args.p_expected_status,original.status);
  assert.equal(calls[0].args.p_expected_updated_at,original.updated_at);
  withdraw.resolve({data:{...original,status:'withdrawn'},error:null});await app.flush();
  refresh.resolve(page([original]));await app.flush();
  assert.ok(app.text.includes('Role one'));assert.ok(app.text.includes('withdrawn'));
  assert.equal(app.nodes().some(n=>n.type==='button'&&text(n)==='Withdraw application'),false);
});

test('account changes immediately clear rows and discard the previous account response',async()=>{
  const pending=deferred();let first=true;
  const app=harness({read:async(name,call)=>{
    assert.equal(name,'my_application_page');
    if(first){first=false;return pending.promise;}
    assert.equal(call.user,'two');
    assert.equal('p_applicant_id' in call.args,false,'the server derives the applicant from the session');
    return page([application('two')]);
  }});
  app.render();await app.flush();app.setUser('two');app.render();await app.flush();
  pending.resolve(page([application('one')]));await app.flush();
  assert.equal(app.nodes().some(n=>n.props?.href==='/jobs/job-one'),false);
  assert.ok(app.nodes().some(n=>n.props?.href==='/jobs/job-two'));
  app.setUser(null);app.render();await app.flush();assert.ok(app.text.includes('Sign in'));assert.equal(app.text.includes('Job no longer available'),false);
});

test('missing dates are truthful and interview details come from application data',async()=>{
  const app=harness({read:async()=>page([application('one',{status:'interview',applied_at:null,interview_at:'2027-01-01T12:00:00Z',interview_location:'Office'})])});
  app.render();await app.flush();assert.ok(app.text.toLowerCase().includes('date unavailable'));assert.ok(app.text.includes('Office'));assert.ok(app.text.includes('Job no longer available'));
});

test('unmount cancels queued account loads',async()=>{
  const app=harness();app.render();await app.flush();app.setUser('two');app.unmount();const before=app.stateWrites;await app.flush();assert.equal(app.stateWrites,before);
});
