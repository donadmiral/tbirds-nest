const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
function harness(status='ringing', isGroup=false, fetcher=async()=>({ok:true,json:async()=>({token:'token',roomUrl:'https://example.daily.co/room'})})) {
  let state={id:'call',status,is_group_call:isGroup},timer,cleared=false;const mutations=[];
  const client={auth:{getSession:async()=>({data:{session:{access_token:'session'}}})},from(){const filters={};let update;const chain={update(value){update=value;return chain;},eq(key,value){filters[key]=value;return chain;},in(key,value){filters[key]=value;return chain;},select(){return chain;},then(ok,bad){const matches=Object.entries(filters).every(([key,value])=>Array.isArray(value)?value.includes(state[key]):state[key]===value);if(matches){state={...state,...update};mutations.push(update);}return Promise.resolve({data:matches?[{id:'call'}]:[],error:null}).then(ok,bad);}};return chain;}};
  const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/services/callService.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};vm.runInNewContext(code,{module,exports:module.exports,require:()=>({supabase:client}),AbortController,Error,fetch:fetcher,process:{env:{}},setTimeout(fn){timer=fn;return 1;},clearTimeout(){cleared=true;},console:{log(){}}});
  return {service:module.exports.callService,state:()=>state,mutations,timeout:()=>timer(),cleared:()=>cleared};
}
test('late accept/decline/missed callbacks cannot revive or overwrite a settled direct call',async()=>{
  for(const status of ['ended','declined','missed']){const h=harness(status);assert.equal(await h.service.acceptCall('call'),false);assert.equal(await h.service.declineCall('call'),false);assert.equal(await h.service.markMissed('call'),false);assert.equal(h.state().status,status);assert.equal(h.mutations.length,0);}
});
test('missed timer cannot interrupt active call and legacy direct lifecycle cannot end shared group call',async()=>{
  const active=harness('active');assert.equal(await active.service.markMissed('call'),false);assert.equal(await active.service.endCall('call',12),true);assert.equal(active.state().duration_sec,12);
  const group=harness('active',true);assert.equal(await group.service.endCall('call',12),false);assert.equal(group.mutations.length,0);
  const ringing=harness();assert.equal(await ringing.service.acceptCall('call'),true);assert.equal(await ringing.service.declineCall('call'),false);assert.equal(ringing.state().status,'active');
});
test('call connection has timeout cleanup and rejects insecure or denied provider responses',async()=>{
  const valid=harness();assert.equal((await valid.service.getDailyToken({callSessionId:'call'})).token,'token');assert.equal(valid.cleared(),true);
  const invalid=harness('ringing',false,async()=>({ok:true,json:async()=>({token:'token',roomUrl:'http://invalid'})}));await assert.rejects(invalid.service.getDailyToken({}),/Invalid call/);assert.equal(invalid.cleared(),true);
  const denied=harness('ringing',false,async()=>({ok:false,status:403}));await assert.rejects(denied.service.getDailyToken({}),/cannot join/);
  const stalled=harness('ringing',false,(_url,{signal})=>new Promise((_ok,bad)=>signal.addEventListener('abort',()=>bad(new Error('aborted')))));
  const pending=stalled.service.getDailyToken({});await new Promise(resolve=>setImmediate(resolve));stalled.timeout();await assert.rejects(pending,/timed out/);assert.equal(stalled.cleared(),true);
});
