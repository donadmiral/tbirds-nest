const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm');
const out={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../shared/liveHostFollow.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:out});
const settle=()=>new Promise(r=>setImmediate(r));
function harness(over={}) {
 let owner=over.owner||'viewer',relation=over.relation||'none',blocked=!!over.blocked,fail=false,writes=[];
 const host=over.host||'business-host';const model=out.createHostFollow(owner,host,'live-room',async(fn,args)=>{
  if(fn==='feed_block_exists')return {data:blocked};
  if(fn==='get_profile')return {data:{id:host,viewer_follows:relation==='following',viewer_requested:relation==='requested'}};
  assert.equal(fn,'set_live_host_follow_v1');writes.push({...args});if(blocked)return {error:{message:'ACCESS_DENIED'}};
  relation=args.p_follow?(over.private?'requested':'following'):'none';if(fail)throw Error('ack lost');return {data:{state:relation}};
 },async()=>owner);
 return {model,writes,setFail(){fail=true},setBlocked(){blocked=true},setOwner(v){owner=v},get:()=>model.snapshot().status};
}
test('private or business hosts use one desired-state RPC for follow/request and unfollow/cancel',async()=>{
 for(const privateHost of [false,true]){
  const c=harness({private:privateHost});c.model.mount();await settle();assert.equal(c.get(),'none');
  await Promise.all([c.model.toggle(),c.model.toggle()]);assert.equal(c.get(),privateHost?'requested':'following');await c.model.toggle();
  assert.equal(c.get(),'none');assert.deepEqual(c.writes,[true,false].map(p_follow=>({p_session_id:'live-room',p_host_id:'business-host',p_follow})));
 }
});
test('self, mutual block, lost session and a server-side access revocation cannot produce a false confirmed follow',async()=>{
 for(const params of [{owner:'business-host'},{blocked:true}]){const c=harness(params);c.model.mount();await settle();await c.model.toggle();assert.equal(c.get(),'hidden');assert.equal(c.writes.length,0);}
 const a=harness();a.model.mount();await settle();a.setOwner('other');await a.model.toggle();assert.equal(a.writes.length,0);
 const b=harness();b.model.mount();await settle();b.setBlocked();await b.model.toggle();assert.equal(b.get(),'hidden');
});
test('lost acknowledgement re-reads committed relation; unmount cannot replay',async()=>{
 const c=harness();const close=c.model.mount();await settle();c.setFail();await c.model.toggle();assert.equal(c.get(),'following');assert.equal(c.writes.length,1);
 close();await c.model.toggle();assert.equal(c.writes.length,1);
});
