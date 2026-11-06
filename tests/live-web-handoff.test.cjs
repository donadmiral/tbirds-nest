const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
function load(file,imports){const module={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,URL,Error,require:name=>{if(name in imports)return imports[name];throw Error('Unexpected import '+name);}});return module.exports;}
const directory=load('shared/liveDirectory.ts',{});
function handoff(openURL=async()=>{}){return load('src/services/liveWebHandoff.ts',{'react-native':{Linking:{openURL}},'../../shared/liveDirectory':directory});}
const id='11111111-1111-4111-8111-111111111111';
test('native handoff constructs only approved public routes and transfers no session or query data',async()=>{
 const opened=[],api=handoff(async url=>opened.push(url));
 await api.openLiveWebPage('connections');await api.openLiveWebPage('publish',id);await api.openLiveWebPage('captions',id);
 assert.deepEqual(opened,['https://platinumcircles.app/live/connections',`https://platinumcircles.app/live/clips/${id}/publish`,`https://platinumcircles.app/live/clips/${id}/captions`]);
 for(const url of opened){const parsed=new URL(url);assert.equal(parsed.origin,'https://platinumcircles.app');assert.equal(parsed.search,'');assert.equal(parsed.hash,'');assert.equal(parsed.username,'');assert.equal(parsed.password,'');}
});
test('invalid clip IDs or route overrides cannot send native auth material or open an arbitrary origin',async()=>{
 let calls=0;const api=handoff(async()=>{calls++;});
 for(const clip of [undefined,'../connections',id+'?access_token=private',id+'#private','https://attacker.invalid','%2f'+id,{id}])await assert.rejects(()=>api.openLiveWebPage('publish',clip),/unavailable/);
 await assert.rejects(()=>api.openLiveWebPage('https://attacker.invalid',id),/unavailable/);await assert.rejects(()=>api.openLiveWebPage('connections',id),/unavailable/);assert.equal(calls,0);
});
test('browser failure is actionable without echoing provider errors, URLs or secret-like data',async()=>{
 const api=handoff(async()=>{throw Error('raw platform failure with private token');});
 await assert.rejects(()=>api.openLiveWebPage('publish',id),error=>error.message==='Your browser could not open. Try again from the clip library.'&&!error.message.includes('token'));
});
