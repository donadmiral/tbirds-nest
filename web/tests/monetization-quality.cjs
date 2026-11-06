const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../app/monetization/page.tsx'), 'utf8');
const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let effect;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect') effect = node.arguments[0].getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(effect);
const compiled = ts.transpileModule('module.exports = ' + effect, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const flush = () => new Promise(resolve => setImmediate(resolve));
function harness(initial) {
  const state = {}, loads = [], refs = {};
  for (const [key, value] of Object.entries({identity:0,requests:0,mutation:false,linkRequest:null,currentUser:undefined})) refs[key] = { current:value };
  let subscriber, unsubscribed=false;
  const client = { auth: {
    onAuthStateChange(fn) { subscriber=fn; return { data:{subscription:{unsubscribe(){unsubscribed=true;}}} }; },
    getSession() { return initial; },
  } };
  const module = { exports:{} };
  const context = { module, client, ...refs, reload:async (...args)=>loads.push(args), withFinanceDeadline:work=>work };
  for (const key of ['Uid','Snapshot','Linked','Error','LinkError','Busy','Accepted','Loading']) context['set'+key] = value => { state[key] = value; };
  vm.runInNewContext(compiled, context);
  const cleanup=module.exports();
  return { state, loads, refs, cleanup, emit:owner=>subscriber('SIGNED_IN',owner ? {user:{id:owner}} : null), get unsubscribed(){return unsubscribed;} };
}
test('initial session failures stay visible and do not leave account loading indefinitely',async()=>{
  for (const result of [()=>Promise.resolve({data:{session:null},error:{message:'failed'}}),()=>Promise.reject(new Error('network'))]) {
    const h=harness(result());await flush();
    assert.equal(h.state.Uid,null);assert.equal(h.state.Loading,false);
    assert.match(h.state.Error,/Could not verify your session/);assert.equal(h.loads.length,0);h.cleanup();
  }
});
test('a late initial session cannot replace the account selected by a newer auth event',async()=>{
  let resolve;const h=harness(new Promise(r=>{resolve=r}));
  h.emit('account-b');resolve({data:{session:{user:{id:'account-a'}}},error:null});await flush();
  assert.equal(h.state.Uid,'account-b');assert.equal(h.refs.currentUser.current,'account-b');
  assert.deepEqual(h.loads.map(x=>x[0]),['account-b']);h.cleanup();
});
test('account changes clear financial data and invalidate work from the earlier account',async()=>{
  const h=harness(Promise.resolve({data:{session:{user:{id:'account-a'}}},error:null}));await flush();
  h.state.Snapshot={user_id:'account-a',balances:[{amount_minor:'10000'}]};h.state.Linked=true;h.state.Busy=true;
  const before=h.refs.identity.current;let aborted=false;h.refs.linkRequest.current={abort(){aborted=true;}};
  h.emit('account-b');
  assert.equal(h.state.Uid,'account-b');assert.equal(h.state.Snapshot,null);assert.equal(h.state.Linked,null);
  assert.equal(h.state.Busy,false);assert.equal(h.refs.identity.current,before+1);assert.equal(aborted,true);
  h.cleanup();assert.equal(h.unsubscribed,true);
});
test('unmount prevents a pending initial session from starting financial reads',async()=>{
  let resolve;const h=harness(new Promise(r=>{resolve=r}));h.cleanup();
  resolve({data:{session:{user:{id:'account-a'}}},error:null});await flush();
  assert.equal(h.loads.length,0);assert.equal(h.refs.currentUser.current,undefined);
});

test('same-account earnings refresh keeps a confirmed snapshot on transient failure and clears denied data',async()=>{
  let declaration;
  const visit=node=>{if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='reload')declaration=node;ts.forEachChild(node,visit);};visit(ast);
  const callback=declaration.initializer.arguments[0].getText(ast);
  const initial={user_id:'owner-a',balances:[{amount_minor:'10000'}]};
  const state={Snapshot:initial};let failure=Object.assign(new Error('temporary'),{retainPreviousSnapshot:true});
  const refs={identity:{current:1},requests:{current:0},linkRequest:{current:null},currentUser:{current:'owner-a'}};
  const context={...refs,client:{},AbortController,setTimeout,clearTimeout,Error,
    readCreatorSnapshot:async()=>{throw failure;},readIntoBankLink:async()=>true,withFinanceDeadline:work=>work};
  for(const key of ['Snapshot','Loading','Error','LinkError','Linked','Accepted'])context['set'+key]=value=>{state[key]=typeof value==='function'?value(state[key]):value;};
  const reload=vm.runInNewContext(ts.transpileModule(`(${callback})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
  await reload('owner-a',1);assert.equal(state.Snapshot,initial);assert.equal(state.Loading,false);assert.match(state.Error,/temporary/);
  failure=Object.assign(new Error('denied'),{retainPreviousSnapshot:false});await reload('owner-a',1);assert.equal(state.Snapshot,null);
  state.Snapshot=initial;refs.identity.current=2;await reload('owner-a',1);assert.equal(state.Snapshot,initial,'An obsolete request cannot clear a newer account result');
});
