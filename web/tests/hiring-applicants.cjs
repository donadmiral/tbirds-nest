const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

// Run the real recruiter handlers with controlled RPC responses. No hosted writes.
const source = fs.readFileSync(process.env.APPLICATIONS_SOURCE || path.join(__dirname, '../app/jobs/[id]/applicants/page.tsx'), 'utf8');
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
const jobId='00000000-0000-4000-8000-000000000010';
const helperModule={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../../shared/hiring.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:helperModule,exports:helperModule.exports,Date});
const hiring=helperModule.exports;
const errorsModule={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../lib/errors.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:errorsModule,exports:errorsModule.exports,Error});
function harness({read = async () => ({data: {id: jobId, posted_by:'owner', title:'Engineer'}, error: null}), rpc = async () => ({data:{applications:[],counts:{all:0},cursor:null,has_more:false}}), sessionError = null, user='owner'} = {}) {
  let authCallback;
  const slots = [], effects = [], calls = [], routes = [];
  let cursor = 0, tree, stateWrites = 0, currentJob = jobId;
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
    rpc: (name,args) => { calls.push({name,args}); return rpc(name,args); },
    auth: {
      getSession: async () => ({data:{session:user ? {user:{id:user}} : null}, error:sessionError}),
      onAuthStateChange: callback => {authCallback=callback; return {data:{subscription:{unsubscribe(){authCallback=null;}}}};},
    },
    from(table) {
      const call={table, filters:[], range:null}; calls.push(call);
      const query={select:()=>query, maybeSingle:()=>query, eq:(...args)=>{call.filters.push(args);return query;},order:()=>query,
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
      if (id === '@/lib/profileLookup') return {profilePath: (name,id)=>'/u/'+id};
      if (id === '@/lib/feed') return {timeAgo: date => date};
      if (id === '@/lib/errors') return errorsModule.exports;
      if (id.endsWith('/shared/hiring')) return hiring;
      if (id === 'next/navigation') return {useParams: () => ({id:currentJob}), useRouter: () => ({push: path => routes.push(path)})};
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
  return { render, flush, find, click, unmount, error, calls, routes, nodes, setJob(next) { currentJob = next; render(); }, setUser(next) {user=next; authCallback?.("SIGNED_IN", next ? {user:{id:next}} : null);}, get text() { return text(tree); }, get stateWrites() { return stateWrites; } };
}



const applicantRow=n=>({id:'app-'+n,job_id:jobId,applicant_id:'user-'+n,status:'applied',applied_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-01T00:00:00Z',applicant:{id:'user-'+n,full_name:'Candidate '+n}});
function page(rows,total=62,more=false){return {data:{applications:rows,counts:{all:total,applied:total,interview:0},has_more:more,cursor:more?{id:rows.at(-1).id,applied_at:rows.at(-1).applied_at}:null},error:null};}
test('applicant page uses complete totals while loading bounded cursor pages',async()=>{
 const all=Array.from({length:62},(_,i)=>applicantRow(i)),app=harness({rpc:async(name,args)=>{const start=args.p_before_id?all.findIndex(row=>row.id===args.p_before_id)+1:0;return page(all.slice(start,start+25),62,start+25<62);}});
 app.render();await app.flush();assert.ok(app.text.includes('All (62)'));assert.equal(app.nodes().filter(n=>n.type==='select').length,25);
 app.click('Load more applicants');app.click('Loading applicants…');await app.flush();assert.equal(app.nodes().filter(n=>n.type==='select').length,50);
 assert.equal(app.calls.filter(c=>c.name==='studio_applicant_page').length,2);assert.equal(app.calls.filter(c=>c.name==='studio_applicant_page')[1].args.p_before_id,'app-24');app.unmount();
});
test('filter change rejects a late previous page and asks the server for the selected status',async()=>{
 const pending=deferred();let first=true;const app=harness({rpc:async(name,args)=>{if(first){first=false;return pending.promise;}assert.equal(args.p_status,'rejected');return page([{...applicantRow('fresh'),status:'rejected'}]);}});
 app.render();await app.flush();app.click('Rejected');await app.flush();pending.resolve(page([applicantRow('stale')]));await app.flush();assert.ok(app.text.includes('Candidate fresh'));assert.ok(!app.text.includes('Candidate stale'));app.unmount();
});
test('account changes clear private candidates and ignore previous account responses',async()=>{
 const pending=deferred();const app=harness({rpc:()=>pending.promise});app.render();await app.flush();app.setUser('other');app.render();await app.flush();pending.resolve(page([applicantRow('private')]));await app.flush();assert.ok(!app.text.includes('Candidate private'));assert.ok(app.text.includes('Only the poster'));app.unmount();
});
test('interview action uses checked RPC once and passes the displayed version',async()=>{
 const row=applicantRow(1),wait=deferred();const app=harness({rpc:async(name)=>name==='studio_applicant_page'?page([row]):wait.promise});app.render();await app.flush();
 app.find(n=>n.type==='select').props.onChange({target:{value:'interview'}});app.render();app.find(n=>n.type==='input'&&n.props.type==='datetime-local').props.onChange({target:{value:'2027-01-01T10:00'}});app.render();
 app.click('Schedule interview');app.click('Schedule interview');await app.flush();const calls=app.calls.filter(c=>c.name==='studio_schedule_interview');assert.equal(calls.length,1);assert.equal(calls[0].args.p_expected_updated_at,row.updated_at);assert.equal(calls[0].args.p_expected_status,'applied');wait.resolve({data:{...row,status:'interview'},error:null});await app.flush();app.unmount();
});

test('status revalidation keeps candidate cards and counts visible until the confirmed replacement arrives',async()=>{
 const wait=deferred(),row=applicantRow('retained');let reads=0;
 const app=harness({rpc:async(name,args)=>name==='studio_applicant_page'?(++reads===1?page([row],62):wait.promise):{data:{...row,status:args.p_status},error:null}});
 app.render();await app.flush();
 app.find(n=>n.type==='select').props.onChange({target:{value:'rejected'}});await app.flush();
 assert.ok(app.text.includes('Candidate retained'));assert.ok(app.text.includes('All (62)'));
 assert.equal(app.nodes().some(n=>n.type==='p'&&text(n)==='Loading'),false);
 wait.resolve(page([],0));await app.flush();
 assert.equal(app.text.includes('Candidate retained'),false);assert.equal(app.text.includes('All (62)'),false);
 assert.ok(app.text.includes('Applications will appear here'));app.unmount();
});

test('a transient refresh error stays beside retained applicants and retry keeps them visible',async()=>{
 const wait=deferred(),row=applicantRow('retained');let reads=0;
 const app=harness({rpc:async(name,args)=>{
   if(name!=='studio_applicant_page')return{data:{...row,status:args.p_status},error:null};
   reads++;return reads===1?page([row],12):reads===2?{data:null,error:{message:'Network unavailable',code:'NETWORK_ERROR'}}:wait.promise;
 }});
 app.render();await app.flush();app.find(n=>n.type==='select').props.onChange({target:{value:'rejected'}});await app.flush();
 assert.ok(app.text.includes('Candidate retained'));assert.ok(app.text.includes('All (12)'));assert.ok(app.find(n=>n.props?.role==='alert'));
 app.click('Retry');await app.flush();assert.ok(app.text.includes('Candidate retained'));assert.ok(app.text.includes('All (12)'));
 assert.equal(app.nodes().some(n=>n.type==='p'&&text(n)==='Loading'),false);
 wait.resolve(page([applicantRow('fresh')],13));await app.flush();assert.ok(app.text.includes('Candidate fresh'));assert.equal(app.text.includes('Candidate retained'),false);app.unmount();
});

for(const denial of [{code:'42501',message:'Denied'},{status:403,message:'Denied'}])test('confirmed access loss clears retained applicant cards and totals: '+JSON.stringify(denial),async()=>{
 const row=applicantRow('private');let reads=0;
 const app=harness({rpc:async(name,args)=>name==='studio_applicant_page'?(++reads===1?page([row],8):{data:null,error:denial}):{data:{...row,status:args.p_status},error:null}});
 app.render();await app.flush();app.find(n=>n.type==='select').props.onChange({target:{value:'rejected'}});await app.flush();
 assert.equal(app.text.includes('Candidate private'),false);assert.equal(app.text.includes('All (8)'),false);assert.ok(app.text.includes('Only the poster'));app.unmount();
});

test('a route change hides the previous job before its new request starts',async()=>{
 const wait=deferred(),other='00000000-0000-4000-8000-000000000020';let reads=0;
 const app=harness({read:async(_table,call)=>({data:{id:call.filters[0][1],title:'Engineer',posted_by:'owner'},error:null}),rpc:async()=>++reads===1?page([applicantRow('old')],7):wait.promise});
 app.render();await app.flush();assert.ok(app.text.includes('Candidate old'));
 app.setJob(other);assert.equal(app.text.includes('Candidate old'),false);assert.equal(app.text.includes('All (7)'),false);
 await app.flush();wait.resolve(page([{...applicantRow('new'),job_id:other}],1));await app.flush();assert.ok(app.text.includes('Candidate new'));app.unmount();
});

test('an account change removes already visible candidate cards immediately',async()=>{
 const app=harness({rpc:async()=>page([applicantRow('private')],11)});app.render();await app.flush();assert.ok(app.text.includes('Candidate private'));
 app.setUser('other');app.render();assert.equal(app.text.includes('Candidate private'),false);assert.equal(app.text.includes('All (11)'),false);await app.flush();assert.ok(app.text.includes('Only the poster'));app.unmount();
});
