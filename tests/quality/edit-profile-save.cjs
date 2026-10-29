const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const source=fs.readFileSync(path.join(__dirname,'../../src/screens/profile/EditProfileScreen.tsx'),'utf8');
const ast=ts.createSourceFile('profile.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function callback(name,scope){let code;function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(ast)===name)code=node.initializer.getText(ast);ts.forEachChild(node,visit);}visit(ast);assert.ok(code);vm.runInNewContext(ts.transpileModule('this.run='+code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,scope);return scope.run;}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
function harness(result=Promise.resolve({data:{id:'owner'},error:null})){
 const saved=[],errors=[],alerts=[],updates=[];let backs=0,queries=0;
 const scope={userId:'owner',profileReady:true,saving:false,busyImage:null,saveLock:{current:false},uploadLock:{current:false},identity:{current:{userId:'owner'}},mounted:{current:true},draft:{full_name:'New name',username:'new_name',headline:'Headline',bio:'About',workplace:'Work',location:'City',links:[{url:'example.com',title:'Site'}],isPrivate:true,avatar_url:'new-avatar',banner_url:'new-banner'},normalizeUrl:url=>'https://'+url,profileRead:request=>request,setSaving:value=>saved.push(value),setError:value=>errors.push(value),Alert:{alert:(...args)=>alerts.push(args)},navigation:{goBack:()=>backs++},useAuthStore:{getState:()=>({profile:{id:'owner',is_verified:true,full_name:'Old'}})},setAuthProfile:value=>updates.push(value),supabase:{from(){queries++;const q={update:value=>{q.payload=value;return q;},eq:()=>q,select:()=>q,maybeSingle:()=>result};return q;}}};
 return{scope,saved,errors,alerts,updates,get backs(){return backs;},get queries(){return queries;},run:callback('save',scope)};
}
test('saving waits for uploads and requires a successfully loaded profile',async()=>{
 for(const change of [{busyImage:'avatar'},{uploadLock:{current:true}},{profileReady:false}]){const h=harness();Object.assign(h.scope,change);await h.run();assert.equal(h.queries,0);assert.equal(h.backs,0);}
});
test('duplicate save taps issue one update and refresh every saved profile field',async()=>{
 const gate=deferred(),h=harness(gate.promise);const pending=h.run();await h.run();assert.equal(h.queries,1);gate.resolve({data:{id:'owner'},error:null});await pending;
 assert.equal(h.backs,1);assert.equal(h.updates[0].username,'new_name');assert.equal(h.updates[0].banner_url,'new-banner');assert.equal(h.updates[0].headline,'Headline');assert.equal(h.updates[0].is_verified,true);assert.equal(h.scope.saveLock.current,false);assert.deepEqual(h.saved,[true,false]);
});
test('no affected row or transport failure keeps edits and unlocks retry',async()=>{
 for(const result of [Promise.resolve({data:null,error:null}),Promise.resolve().then(()=>{throw Error('Network unavailable');})]){const h=harness(result);await h.run();assert.equal(h.backs,0);assert.equal(h.updates.length,0);assert.equal(h.scope.saveLock.current,false);assert.equal(h.saved.at(-1),false);assert.ok(h.errors.at(-1));assert.equal(h.scope.draft.avatar_url,'new-avatar');}
});
test('late saves cannot alter the next account, including switch away and back',async()=>{
 const gate=deferred(),h=harness(gate.promise),pending=h.run();h.scope.identity.current={userId:'other'};h.scope.identity.current={userId:'owner'};gate.resolve({data:{id:'owner'},error:null});await pending;assert.equal(h.updates.length,0);assert.equal(h.backs,0);
});
