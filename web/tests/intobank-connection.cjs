const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(require('node:path').join(__dirname, '../lib/monetization.ts'), 'utf8');
const ast = ts.createSourceFile('monetization.ts', source, ts.ScriptTarget.Latest, true);
const node = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'linkIntoBankAccount');
assert.ok(node);
const js = ts.transpileModule(node.getText(ast).replace(/^export\s+/, '') + '\nmodule.exports = linkIntoBankAccount;', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
function setup({ initial = 'owner', final = initial, status = 200, body = { success: true }, reject = false, stallAt = -1 } = {}) {
  const requests = [], module = { exports: {} };
  let checks = 0, finishSession;
  const client = { auth: { getSession: async () => { const attempt=checks++,result={ error: null, data: { session: { user: { id: attempt ? final : initial }, access_token: 'fixture-token' } } }; if(attempt===stallAt)return new Promise(resolve=>{finishSession=()=>resolve(result);});return result; } } };
  vm.runInNewContext(js, { module, process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fixture-public-key' } },
    fetch: async (url, opts) => { requests.push({ url, opts }); if (reject) throw Error('offline'); return { ok: status >= 200 && status < 300, status, json: async () => body }; } });
  return { requests, client, link:module.exports, finishSession:()=>finishSession?.(), run: (code = ' abc123ef ', signal = new AbortController().signal) => module.exports(client, 'owner', code, signal) };
}
test('web linking uses the same normalized approval-code contract as the phone', async () => {
  const h = setup(); await h.run();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, 'https://fixture.supabase.co/functions/v1/crisp-bridge?action=link');
  assert.equal(h.requests[0].opts.method, 'POST');
  assert.deepEqual(JSON.parse(h.requests[0].opts.body), { code: 'ABC123EF' });
});
test('bad approval codes and switched accounts cannot submit a link', async () => {
  const invalid = setup(); await assert.rejects(() => invalid.run('bad'), /8-character/); assert.equal(invalid.requests.length, 0);
  const switched = setup({ initial: 'different-owner' }); await assert.rejects(() => switched.run(), /account changed/); assert.equal(switched.requests.length, 0);
});
test('late success cannot connect the new account after an account change', async () => {
  await assert.rejects(() => setup({ final: 'different-owner' }).run(), /account changed/);
});
test('unconfirmed responses and transport failures never appear connected or auto-retry', async () => {
  for (const opts of [{ body: { success: false } }, { body: null }, { reject: true }]) {
    const h = setup(opts); await assert.rejects(() => h.run(), /not confirm|not confirmed/); assert.equal(h.requests.length, 1);
  }
});
test('provider permission errors give safe connection guidance', async () => {
  const h = setup({ status: 403, body: { success: false, error: 'private upstream configuration detail' } });
  await assert.rejects(() => h.run(), /has not enabled this connection/);
});

const ticks=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
test('cancellation bounds both session waits and late authentication never submits or reports success',async()=>{
 for(const stallAt of [0,1]){
  const h=setup({stallAt}),controller=new AbortController(),pending=h.run('ABC123EF',controller.signal);
  await ticks();assert.equal(h.requests.length,stallAt);
  const rejected=assert.rejects(pending,/not confirmed/);controller.abort();await rejected;
  h.finishSession();await ticks();assert.equal(h.requests.length,stallAt,'No late submission or automatic retry');
 }
});

test('the form clears busy after the deadline or Stop waiting while retaining truthful uncertainty',async()=>{
 const component=ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname,'../components/IntoBankConnectionForm.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const walk=node=>Array.isArray(node)?node.flatMap(walk):node&&typeof node==='object'?[node,...walk(node.props?.children)]:[];
 for(const stop of ['deadline','button']){
  const h=setup({stallAt:0}),values=[],effects=[],timers=new Map(),module={exports:{}};let cursor=0,nextTimer=0,changes=0;
  const jsx=(type,props)=>({type,props}),hooks={useState(initial){const i=cursor++;if(!(i in values))values[i]=typeof initial==='function'?initial():initial;return[values[i],next=>values[i]=typeof next==='function'?next(values[i]):next];},useRef(initial){const i=cursor++;return values[i]??={current:initial};},useEffect(fn){const i=cursor++;if(!(i in values)){values[i]=true;effects.push(fn);}}};
  vm.runInNewContext(component,{module,exports:module.exports,AbortController,require:name=>{if(name==='react')return hooks;if(name==='react/jsx-runtime')return{jsx,jsxs:jsx};if(name==='@/lib/supabase/client')return{createClient:()=>h.client};if(name==='@/lib/monetization')return{linkIntoBankAccount:h.link};throw Error(name);},setTimeout(fn){const id=++nextTimer;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);}});
  const render=()=>{cursor=0;const tree=module.exports.default({owner:'owner',onChanged:()=>changes++});while(effects.length)effects.shift()();return tree;};
  render().props.onClick();let tree=render();walk(tree).find(n=>n.type==='input').props.onChange({target:{value:'ABC123EF'}});tree=render();
  const pending=tree.props.onSubmit({preventDefault(){}});await ticks();tree=render();
  assert.equal(walk(tree).find(n=>n.props?.type==='submit').props.disabled,true);
  const cancel=walk(tree).find(n=>n.props?.children==='Stop waiting');assert.ok(cancel);assert.notEqual(cancel.props.disabled,true);
  if(stop==='button')cancel.props.onClick();else [...timers.values()][0]();
  await pending;tree=render();assert.equal(walk(tree).find(n=>n.props?.type==='submit').props.disabled,false);
  assert.ok(walk(tree).find(n=>n.props?.role==='alert'));assert.equal(changes,1);assert.equal(timers.size,0);assert.equal(h.requests.length,0);
 }
});
