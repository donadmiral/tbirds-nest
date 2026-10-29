const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.join(__dirname,'../..');
function compile(file,imports={},globals={}){const module={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,require:name=>imports[name],...globals});return module.exports;}
const normalize=compile('src/utils/profilePost.ts').normalizeProfilePost;
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(initial,hydrate){let rows=initial,cleanup;const events=new Set(),timers=new Set(),errors=[];const app={currentState:'active',addEventListener:(_event,fn)=>{events.add(fn);return{remove:()=>events.delete(fn)};}};
 const hooks={useRef:value=>({current:value}),useEffect:fn=>{cleanup=fn();}};
 const hook=compile('src/hooks/useProfileMediaRefresh.ts',{'react':hooks,'react-native':{AppState:app},'../services/contentMedia':{hydratePostMedia:hydrate},'../utils/profilePost':{normalizeProfilePost:normalize}},{Date:{now:()=>100000},setInterval:fn=>{timers.add(fn);return fn;},clearInterval:fn=>timers.delete(fn)}).useProfileMediaRefresh;
 hook(rows,update=>{rows=typeof update==='function'?update(rows):update;},'viewer:owner',true,value=>errors.push(value));
 return{get rows(){return rows;},errors,dispose:()=>cleanup?.(),replace:value=>rows=value,tick:()=>{for(const fn of timers)fn();},state:value=>{app.currentState=value;for(const fn of events)fn(value);},get listeners(){return events.size;}};
}
test('profile renewal keeps pagination and renews only expiring signed attachments',async()=>{
 const calls=[],old={id:'one',_mediaExpiresAt:120000,post_media:[{url:'old.jpg'}]},fresh={id:'two',_mediaExpiresAt:300000,post_media:[{url:'fresh.jpg'}]};
 const f=fixture([old,fresh],async rows=>{calls.push(rows);return rows.map(row=>({...row,_mediaExpiresAt:400000,post_media:[{url:'renewed.jpg'}]}));});await turn();
 assert.equal(calls[0].length,1);assert.equal(f.rows.length,2);assert.equal(f.rows[0].media[0].url,'renewed.jpg');assert.equal(f.rows[1],fresh);f.dispose();assert.equal(f.listeners,0);
});
test('a late renewal cannot overwrite a newer profile read or a changed account',async()=>{
 const gate=deferred(),f=fixture([{id:'one',_mediaExpiresAt:120000,post_media:[{url:'old.jpg'}]}],()=>gate.promise);
 const newer={id:'one',_mediaExpiresAt:500000,post_media:[{url:'newer.jpg'}]};f.replace([newer]);gate.resolve([{id:'one',_mediaExpiresAt:400000,post_media:[{url:'stale.jpg'}]}]);await turn();assert.equal(f.rows[0],newer);f.dispose();
 const late=deferred(),g=fixture([{id:'one',_mediaExpiresAt:120000}],()=>late.promise);g.dispose();const current=g.rows;late.resolve([{id:'one',_mediaExpiresAt:400000}]);await turn();assert.equal(g.rows,current);
});
test('denied media stays denied after refresh and signing outages expose a retry message',async()=>{
 const f=fixture([{id:'one',_mediaExpiresAt:120000,post_media:[{url:'old.jpg'}]}],async rows=>rows.map(row=>({...row,_mediaExpiresAt:400000,post_media:[{url:null}]})));await turn();assert.equal(f.rows[0].media.length,0);assert.equal(f.rows[0].mediaUnavailable,true);f.dispose();
 const g=fixture([{id:'one',_mediaExpiresAt:120000}],async()=>{throw Error('offline');});await turn();assert.match(g.errors[0],/Retry/);g.dispose();
});
