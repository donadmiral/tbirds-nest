const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { test } = require('node:test');
const compile = file => ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const source = compile('app/[username]/follows/page.tsx');
const profileModule = { exports: {} };
vm.runInNewContext(compile('lib/profileLookup.ts'), { module: profileModule, exports: profileModule.exports });
const text = n => typeof n === 'string' || typeof n === 'number' ? String(n) : Array.isArray(n) ? n.map(text).join('') : text(n?.props?.children ?? '');
const nodes = n => !n || typeof n !== 'object' ? [] : Array.isArray(n) ? n.flatMap(nodes) : [n, ...nodes(n.props?.children)];
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

function harness() {
  let cursor = 0, tree, dirty = true, profileFailure = false, lookup = 0;
  const slots = [], effects = [], requests = [];
  const owner = '10000000-0000-0000-0000-000000000001';
  let rows = async () => ({ data: [], error: null });
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], next => { const v = typeof next === 'function' ? next(slots[i]) : next; if (!Object.is(v, slots[i])) { slots[i] = v; dirty = true; } }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useMemo(fn, deps) { const i = cursor++; if (!slots[i] || deps.some((v,k) => !Object.is(v,slots[i].deps[k]))) slots[i] = { value:fn(), deps }; return slots[i].value; },
    useCallback(fn, deps) { return hooks.useMemo(() => fn, deps); },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || deps.some((v,k) => !Object.is(v,slots[i].deps[k]))) {
      const previous = slots[i]; slots[i] = {deps}; effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = fn(); });
    } },
  };
  const client = {
    auth: { getSession: async () => ({ data: {session: {user: {id:owner}}}, error:null }) },
    rpc: async () => ({data:null,error:null}),
    from(table) {
      let col, from = 0, ids;
      const q = {select(value){col=value;return q;},eq(){return q;},neq(){return q;},ilike(){return q;},limit(){return q;},order(){return q;},
        range(start){from=start;return q;},in(_col, values){ids=values;return q;},
        maybeSingle:async()=>{lookup++;return profileFailure?{data:null,error:{message:'offline'}}:{data:{id:owner,username:'owner',full_name:'Owner'},error:null};},
        then(ok,bad){return Promise.resolve().then(()=>{
          if(table==='follows'){const req={col,from};requests.push(req);return rows(req);}
          return {data:ids.map(id=>({id,full_name:id,username:id,avatar_url:null})),error:null};
        }).then(ok,bad);}};
      return q;
    },
  };
  const jsx=(type,props)=>({type,props}); const mod={exports:{}};
  vm.runInNewContext(source,{module:mod,exports:mod.exports,window:{confirm:()=>true},require(id){
    if(id==='react')return hooks;
    if(id==='react/jsx-runtime')return {jsx,jsxs:jsx};
    if(id==='next/navigation')return {useParams:()=>({username:'owner'}),useSearchParams:()=>new URLSearchParams()};
    if(id==='@/lib/supabase/client')return {createClient:()=>client};
    if(id==='@/lib/profileLookup')return profileModule.exports;
    return new Proxy({},{get:(_,key)=>String(key)});
  }});
  const render=()=>{for(let round=0;dirty&&round<20;round++){dirty=false;cursor=0;tree=mod.exports.default();while(typeof tree?.type==='function')tree=tree.type(tree.props);while(effects.length)effects.shift()();}assert.equal(dirty,false,'effects settle');};
  const flush=async()=>{for(let i=0;i<7;i++){render();await new Promise(r=>setImmediate(r));}render();};
  const click=label=>{const button=nodes(tree).find(n=>n.type==='button'&&text(n)===label);assert.ok(button,'Missing '+label);assert.notEqual(button.props.disabled,true);button.props.onClick();render();};
  const doubleClick=label=>{const button=nodes(tree).find(n=>n.type==='button'&&text(n)===label);assert.ok(button);button.props.onClick();button.props.onClick();render();};
  return {flush,click,doubleClick,requests,get text(){return text(tree);},get lookup(){return lookup;},set profileFailure(v){profileFailure=v;},set rows(fn){rows=fn;}};
}

test('profile read failure is explicit and retry does not pretend the profile is missing',async()=>{
  const h=harness();h.profileFailure=true;await h.flush();assert.match(h.text,/Could not load this profile/);assert.doesNotMatch(h.text,/Profile not found/);
  h.profileFailure=false;h.click('Try again');await h.flush();assert.equal(h.lookup,2);assert.match(h.text,/No followers yet/);
});
test('late followers result cannot overwrite the selected following list',async()=>{
  const old=defer();const h=harness();h.rows=({col})=>col==='follower_id'?old.promise:{data:[{following_id:'new-following'}],error:null};
  await h.flush();h.click('Following');await h.flush();assert.match(h.text,/new-following/);
  old.resolve({data:[{follower_id:'stale-follower'}],error:null});await h.flush();assert.match(h.text,/new-following/);assert.doesNotMatch(h.text,/stale-follower/);
});
test('failed next-page read retains existing people and retries the same page',async()=>{
  const h=harness();let fail=true;h.rows=({from})=>from===0?{data:Array.from({length:40},(_,i)=>({follower_id:'person-'+i})),error:null}
    :fail?{data:null,error:{message:'offline'}}:{data:[{follower_id:'last-person'}],error:null};
  await h.flush();h.click('Show more');await h.flush();assert.match(h.text,/person-0/);assert.match(h.text,/Could not load connections/);
  fail=false;h.click('Try again');await h.flush();assert.match(h.text,/last-person/);assert.deepEqual(h.requests.map(r=>r.from),[0,40,40]);
});
test('duplicate next-page clicks start one request',async()=>{
  const next=defer();const h=harness();h.rows=({from})=>from===0?{data:Array.from({length:40},(_,i)=>({follower_id:'person-'+i})),error:null}:next.promise;
  await h.flush();h.doubleClick('Show more');await h.flush();assert.equal(h.requests.filter(r=>r.from===40).length,1);assert.doesNotMatch(h.text,/Show more/);
  next.resolve({data:[],error:null});await h.flush();assert.equal(h.requests.length,2);
});
