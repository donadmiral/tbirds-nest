const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
function load(file, imports = {}, globals = {}) {
  const exports = {};
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(js, { exports, require: (name) => imports[name] ?? {}, console, setTimeout, clearTimeout, ...globals }, { filename: file });
  return exports;
}
const webPublication = load(path.join(root, 'lib/publication.ts'));
for (const [surface, file] of [['web', path.join(root, 'lib/publication.ts')], ['native', path.join(root, '../src/utils/publication.ts')]]) {
  const { PublicationAttempt } = load(file);
  test(`${surface}: retry resumes failed child without re-inserting parent or confirmed siblings`, async () => {
    const attempt = new PublicationAttempt();
    let posts = 0, media = 0, tags = 0;
    const publish = async () => {
      const post = await attempt.write('post', async () => ({ data: { id: ++posts }, error: null }));
      await attempt.write('media', async () => ({ data: ++media, error: null }));
      await attempt.write('tags', async () => ({ data: null, error: ++tags === 1 ? { code: '42501', message: 'Denied' } : null }));
      return post.id;
    };
    await assert.rejects(publish);
    assert.equal(await publish(), 1);
    assert.deepEqual([posts, media, tags], [1, 1, 2]);
  });
  for (const error of [{ message: 'Failed to fetch' }, { code: '08007', message: 'Unknown transaction resolution' }, { code: '40003', message: 'Unknown statement completion' }, { code: 'PGRST116', message: 'No confirmed row' }]) {
    test(`${surface}: ${error.code ?? 'network error'} blocks an unconfirmed write from replay`, async () => {
      const attempt = new PublicationAttempt();
      let calls = 0;
      const work = () => { calls++; return Promise.resolve({ data: null, error }); };
      await assert.rejects(() => attempt.write('story', work));
      await assert.rejects(() => attempt.write('story', work));
      assert.equal(attempt.uncertain, true);
      assert.equal(calls, 1);
    });
  }
  test(`${surface}: a thrown transport failure blocks replay`, async () => {
    const attempt = new PublicationAttempt();
    let calls = 0;
    const work = async () => { calls++; throw new Error('Disconnected'); };
    await assert.rejects(() => attempt.write('story', work));
    await assert.rejects(() => attempt.write('story', work));
    assert.equal(calls, 1);
  });
}

// Exercise real Composer event handlers with synthetic React state and database
// responses. No browser session, network, or production content is used.
function harness(responses, { owner = 'author', mount = false } = {}) {
  let slot = 0, dirty = false;
  const values = [];
  const calls = [];
  const draft = new Map(), effects = [];
  let sessionOwner = owner, authListener;
  const state = (initial) => {
    const key = slot++;
    if (!(key in values)) values[key] = typeof initial === 'function' ? initial() : initial;
    return [values[key], (value) => { const next=typeof value === 'function' ? value(values[key]) : value;if(!Object.is(next,values[key])){values[key]=next;dirty=true;} }];
  };
  const effect=(fn,deps,enabled)=>{const i=slot++,old=values[i];if(!old||!deps||deps.some((value,j)=>!Object.is(value,old.deps[j]))){const record={deps,cleanup:old?.cleanup};values[i]=record;if(enabled)effects.push(()=>{old?.cleanup?.();record.cleanup=fn();});}};
  const react = { useState: state, useRef: (value) => state(() => ({ current: value }))[0], useEffect(fn,deps){effect(fn,deps,mount);},useLayoutEffect(fn,deps){effect(fn,deps,true);},
    useMemo(fn,deps){const i=slot++,old=values[i];if(!old||deps.some((value,j)=>!Object.is(value,old.deps[j])))values[i]={deps,value:fn()};return values[i].value;},
    useCallback(fn,deps){return react.useMemo(()=>fn,deps);},useSyncExternalStore(subscribe,snapshot){effect(()=>subscribe(()=>{dirty=true;}),[subscribe],mount);return snapshot();} };

  const jsx = (type, props) => ({ type, props });
  const client = {
    auth: { getUser:async()=>({data:{user:sessionOwner?{id:sessionOwner}:null},error:null}),getSession: async () => ({ data: { session: sessionOwner ? { user: { id: sessionOwner } } : null } }),onAuthStateChange(fn){authListener=fn;return{data:{subscription:{unsubscribe(){authListener=null;}}}};} },
    from(table) {
      const builder = {
        insert(payload) { calls.push({ table, payload }); return builder; },
        upsert(payload, options) { calls.push({ table, payload, options }); return builder; },
        select() { return builder; }, eq() { return builder; }, maybeSingle() { return builder; }, single() { return builder; },
        then(resolve, reject) {
          const queue = responses[table] || [];
          return Promise.resolve(queue.shift() ?? { data: null, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
  const imports = new Proxy({
    react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    '@/lib/supabase/client': { createClient: () => client },
    '@/lib/publication': webPublication,
    '@/lib/categories': { CATEGORIES: [] },
    '@/lib/stories': { STORY_FILTERS: [] },
    './PostComposer.module.css':{default:{}},
  }, { get: (target, key) => target[key] ?? {} });
  const listeners=new Map();
  const globals = { Event,StorageEvent:class StorageEvent extends Event{},window:{addEventListener(name,fn){const group=listeners.get(name)||new Set();group.add(fn);listeners.set(name,group);},removeEventListener(name,fn){listeners.get(name)?.delete(fn);},dispatchEvent(event){listeners.get(event.type)?.forEach(fn=>fn(event));}},document:{activeElement:null,body:{style:{overflow:''}},addEventListener(){},removeEventListener(){}},HTMLElement:class HTMLElement{},requestAnimationFrame(fn){fn();return 1;},cancelAnimationFrame(){},crypto: require('node:crypto').webcrypto, localStorage: { getItem: (key) => draft.get(key), setItem: (key, value) => draft.set(key, value), removeItem: (key) => draft.delete(key) }, URL: { revokeObjectURL() {} } };
  imports['@/lib/useBrowserStorage']=load(path.join(root,'lib/useBrowserStorage.ts'),imports,globals);
  let posted = 0;
  const { Composer } = load(path.join(root, 'components/Composer.tsx'), imports, globals);
  const render = () => { let tree,round=0;do{dirty=false;slot=0;tree=Composer({ownerId:owner,onPosted:()=>{posted++;}});while(typeof tree?.type==='function')tree=tree.type(tree.props);while(effects.length)effects.shift()();if(++round>20)throw Error('Composer did not settle');}while(dirty);return tree; };
  const flush=async()=>{for(let i=0;i<5;i++){await new Promise(setImmediate);render();}};
  const all = (node) => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(all) : [node, ...all(node.props?.children)];
  const text = (node) => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node?.props ? text(node.props.children) : '';
  const button = (tree, label) => all(tree).findLast((n) => n.type === 'button' && text(n) === label);
  const input = (tree, placeholder) => all(tree).find((n) => n.props?.placeholder === placeholder);
  const preparePoll = () => {
    button(render(), ' Poll').props.onClick();
    input(render(), 'Write a caption…').props.onChange({ target: { value: 'Question' } });
    input(render(), 'Option 1').props.onChange({ target: { value: 'One' } });
    input(render(), 'Option 2').props.onChange({ target: { value: 'Two' } });
    button(render(),'Review').props.onClick();
  };
  return { render, flush, button, input, preparePoll, calls, posted: () => posted, all, text, client, draft, setSession(next,notify=false){sessionOwner=next;if(notify)authListener?.('SIGNED_IN',next?{user:{id:next}}:null);},unmount(){values.forEach(value=>value?.cleanup?.());} };
}
test('Composer retains poll draft on child failure; Retry only saves missing options', async () => {
  const h = harness({ posts: [{ data: { id: 'post-1' }, error: null }], post_polls: [{ data: null, error: null }], post_poll_options: [{ data: null, error: { code: '42501', message: 'Options denied' } }, { data: null, error: null }] });
  h.preparePoll();
  await h.button(h.render(), 'Post').props.onClick();
  assert.equal(h.posted(), 0);
  assert.equal(h.input(h.render(), 'Write a caption…').props.value, 'Question');
  await h.button(h.render(), 'Retry').props.onClick();
  assert.equal(h.posted(), 1);
  assert.deepEqual(h.calls.map((x) => x.table), ['posts', 'post_polls', 'post_poll_options', 'post_poll_options']);
});
test('Composer can collapse and reopen an in-flight post without restarting or losing its draft', async()=>{
 let finish;const held=new Promise(resolve=>finish=resolve);
 const h=harness({posts:[held]});h.preparePoll();const pending=h.button(h.render(),'Post').props.onClick();
 const collapse=()=>h.all(h.render()).find(n=>n.type==='button'&&h.text(n).trim()==='Continue browsing this feed').props.onClick();
 collapse();assert.ok(h.button(h.render(),'View upload progress'));assert.equal(h.input(h.render(),'Write a caption…'),undefined);
 h.button(h.render(),'View upload progress').props.onClick();assert.equal(h.input(h.render(),'Write a caption…').props.value,'Question');
 collapse();finish({data:{id:'confirmed'},error:null});await pending;
 assert.equal(h.posted(),1);assert.deepEqual(h.calls.map(c=>c.table),['posts','post_polls','post_poll_options']);assert.match(h.text(h.render()),/Your post has been shared/);
});
test('a failed collapsed publication keeps its original draft and opens a concrete retry', async()=>{
 let finish;const held=new Promise(resolve=>finish=resolve);const h=harness({posts:[held]});h.preparePoll();const pending=h.button(h.render(),'Post').props.onClick();
 h.all(h.render()).find(n=>n.type==='button'&&h.text(n).trim()==='Continue browsing this feed').props.onClick();
 finish({data:null,error:{code:'42501',message:'Temporary denied write'}});await pending;assert.equal(h.posted(),0);
 h.button(h.render(),'Review post').props.onClick();assert.equal(h.input(h.render(),'Write a caption…').props.value,'Question');assert.ok(h.button(h.render(),'Retry'));
});
test('Composer refuses same-tick duplicate submissions', async () => {
  const h = harness({ posts: [{ data: { id: 'post-1' }, error: null }] });
  h.button(h.render(), 'Post').props.onClick();
  h.input(h.render(), 'Write a caption…').props.onChange({ target: { value: 'Text' } });
  h.button(h.render(),'Review').props.onClick();
  const submit = h.button(h.render(), 'Post').props.onClick;
  await Promise.all([submit(), submit()]);
  assert.equal(h.calls.filter((x) => x.table === 'posts').length, 1);
  assert.equal(h.posted(), 1);
});
test('Composer retains stable IDs when a lost response is safely retried', async () => {
  const h = harness({ posts: [{ data: null, error: { message: 'Failed to fetch' } }] });
  h.button(h.render(), 'Post').props.onClick();
  h.input(h.render(), 'Write a caption…').props.onChange({ target: { value: 'Keep this draft' } });
  h.button(h.render(),'Review').props.onClick();
  await h.button(h.render(), 'Post').props.onClick();
  assert.equal(h.posted(), 0);
  assert.equal(h.input(h.render(), 'Write a caption…').props.value, 'Keep this draft');
  await h.button(h.render(), 'Retry').props.onClick();
  assert.equal(h.posted(), 1);
  assert.equal(h.calls[0].payload[0].id, h.calls[1].payload[0].id);
  assert.equal(h.calls[1].options.ignoreDuplicates, true);
});

test('idempotent writes can retry lost responses but keep confirmed checkpoints', async()=>{const {PublicationAttempt}=webPublication;const p=new PublicationAttempt();let calls=0;await assert.rejects(()=>p.writeIdempotent('stable',async()=>{calls++;throw Error('lost');}));assert.equal(p.uncertain,false);await p.writeIdempotent('stable',async()=>{calls++;return{data:'same-id',error:null};});assert.equal(await p.writeIdempotent('stable',async()=>{throw Error('must not replay');}),'same-id');assert.equal(calls,2);});

test('Composer never publishes an Account A draft under a later Account B session',async()=>{
 const h=harness({}, {owner:'account-a'});h.button(h.render(),'Post').props.onClick();h.input(h.render(),'Write a caption…').props.onChange({target:{value:'Account A private draft'}});h.button(h.render(),'Review').props.onClick();h.setSession('account-b');await h.button(h.render(),'Post').props.onClick();assert.equal(h.calls.length,0);assert.equal(h.posted(),0);assert.match(h.text(h.render()),/account that started this post/);assert.equal(h.input(h.render(),'Write a caption…').props.value,'Account A private draft');
 h.setSession('account-a');await h.button(h.render(),'Retry').props.onClick();assert.equal(h.posted(),1);assert.equal(h.calls.find(c=>c.table==='posts').payload[0].user_id,'account-a');
});
test('account changes during the first authentication read prevent every post write',async()=>{
 const h=harness({}, {owner:'account-a'});h.preparePoll();let finish;h.client.auth.getSession=()=>new Promise(resolve=>finish=resolve);const pending=h.button(h.render(),'Post').props.onClick();finish({data:{session:{user:{id:'account-b'}}}});await pending;assert.equal(h.calls.length,0);assert.equal(h.posted(),0);
});
test('post draft restoration and persistence are isolated to the authenticated owner',async()=>{
 const a=harness({}, {owner:'account-a',mount:true});a.draft.set('pc_draft_web:account-a',JSON.stringify({text:'Account A only'}));a.draft.set('pc_draft_web:account-b',JSON.stringify({text:'Account B only'}));a.draft.set('pc_draft_web',JSON.stringify({text:'Unattributed legacy draft'}));a.render();await a.flush();assert.equal(a.input(a.render(),'Write a caption…').props.value,'Account A only');a.unmount();
 const b=harness({}, {owner:'account-b',mount:true});for(const[key,value]of a.draft)b.draft.set(key,value);b.render();await b.flush();assert.equal(b.input(b.render(),'Write a caption…').props.value,'Account B only');b.input(b.render(),'Write a caption…').props.onChange({target:{value:'B edited'}});b.render();assert.equal(JSON.parse(b.draft.get('pc_draft_web:account-a')).text,'Account A only');assert.equal(JSON.parse(b.draft.get('pc_draft_web:account-b')).text,'B edited');b.unmount();
});
test('A-to-B-to-A auth events invalidate an old in-flight post despite returning to the same ID',async()=>{
 let finish;const held=new Promise(resolve=>finish=resolve),h=harness({posts:[held]}, {owner:'account-a',mount:true});h.preparePoll();const pending=h.button(h.render(),'Post').props.onClick();for(let i=0;i<60&&!h.calls.some(c=>c.table==='posts');i++)await Promise.resolve();assert.equal(h.calls.filter(c=>c.table==='posts').length,1,h.text(h.render()));h.setSession('account-b',true);h.setSession('account-a',true);finish({data:null,error:null});await pending;assert.equal(h.posted(),0);assert.equal(h.calls.some(c=>c.table==='post_polls'),false);h.unmount();
});
test('HomeFeed remounts the owner-scoped composer and clears previous quote intent on auth changes',()=>{
 const source=fs.readFileSync(path.join(root,'components/HomeFeed.tsx'),'utf8'),ast=ts.createSourceFile('HomeFeed.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let callback,element;function visit(n){if(ts.isCallExpression(n)&&n.expression.getText(ast).endsWith('auth.onAuthStateChange'))callback=n.arguments[0].getText(ast);if(ts.isConditionalExpression(n)&&n.whenTrue.getText(ast).startsWith('<Composer '))element=n.getText(ast);ts.forEachChild(n,visit);}visit(ast);assert.ok(callback&&element);
 const ctx={exports:{},uidRef:{current:'account-a'},seenPendingRef:{current:new Set()},seenSentRef:{current:new Set()},state:{owner:'account-a'},composerGeneration:0,quote:{id:'old'},composeKind:undefined,composeRequest:0,thenPromote:false,setThenPromote(value){ctx.thenPromote=value;},controller:{setOwner(value){ctx.state.owner=value;}},setComposerGeneration(fn){ctx.composerGeneration=fn(ctx.composerGeneration);},setQuote(value){ctx.quote=value;},setComposeKind(value){ctx.composeKind=value;},queueMicrotask(){},router:{refresh(){},replace(){}},load(){},Composer:'Composer',require:()=>({jsx:(type,props,key)=>({type,props,key})})};vm.createContext(ctx);const js=text=>ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInContext(js('this.auth='+callback+';this.render=()=>('+element+');'),ctx);const original=ctx.render();ctx.auth('SIGNED_IN',{user:{id:'account-b'}});const next=ctx.render();assert.equal(next.props.ownerId,'account-b');assert.notEqual(next.key,original.key);assert.equal(next.props.quote,null);ctx.auth('SIGNED_IN',{user:{id:'account-a'}});assert.notEqual(ctx.render().key,original.key);ctx.auth('SIGNED_OUT',null);assert.equal(ctx.render(),null);
});


test('a delayed draft read never overwrites text already entered in the composer',async()=>{
 const h=harness({}, {owner:'account-a',mount:true});let finish;
 h.client.auth.getUser=()=>new Promise(resolve=>{finish=resolve;});
 h.draft.set('pc_draft_web:account-a',JSON.stringify({text:'Earlier saved caption'}));
 h.button(h.render(),'Post').props.onClick();
 h.input(h.render(),'Write a caption…').props.onChange({target:{value:'New caption typed during the session check'}});
 h.render();finish({data:{user:{id:'account-a'}},error:null});await h.flush();
 assert.equal(h.input(h.render(),'Write a caption…').props.value,'New caption typed during the session check');
 assert.equal(JSON.parse(h.draft.get('pc_draft_web:account-a')).text,'New caption typed during the session check');h.unmount();
});
