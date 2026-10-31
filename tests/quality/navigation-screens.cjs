const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.resolve(__dirname,'../..');
const source=fs.readFileSync(path.join(root,'src/screens/feed/TrendFeedScreen.tsx'),'utf8'),ast=ts.createSourceFile('TrendFeed.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function declaration(name){let found;function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.getText(ast)===name)found=node.getText(ast);if(ts.isVariableDeclaration(node)&&node.name.getText(ast)===name)found='const '+node.getText(ast)+';';ts.forEachChild(node,visit);}visit(ast);assert.ok(found,name);return found;}
function compile(code,globals={}){const module={exports:{}};vm.runInNewContext(ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,Error,Map,Set,Date,Promise,AbortController,setTimeout,clearTimeout,console,...globals});return module.exports;}
const helpers=['PAGE_SIZE','trendRow','buildExactTagRegex','readTrendPage'].map(declaration).join('\n');
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const turn=()=>new Promise(done=>setImmediate(done));
function queries(respond){const calls=[];function q(table,args){const call={table,args,headers:{},filters:{}};const chain={setHeader(k,v){call.headers[k]=v;return chain;},abortSignal(signal){call.signal=signal;return chain;},then(ok,bad){calls.push(call);return Promise.resolve().then(()=>respond(call)).then(ok,bad);}};for(const m of ['select','order'])chain[m]=()=>chain;for(const m of ['in','ilike'])chain[m]=(k,v)=>{call.filters[k]=v;return chain;};chain.range=(a,b)=>{call.range=[a,b];return chain;};return chain;}return{calls,client:{rpc:(name,args)=>q(name,args),from:table=>q(table)}};}

test('topic reads pin the owner token and never mask a network error with a compatibility query',async()=>{
 const h=queries(()=>({data:null,error:{code:'NETWORK'}})),{read}=compile(helpers+'\nexport const read=readTrendPage;',{supabase:h.client}),controller=new AbortController();
 await assert.rejects(read('#topic',0,controller.signal,'owner-token'),/could not be refreshed/);assert.equal(h.calls.length,1);assert.equal(h.calls[0].headers.Authorization,'Bearer owner-token');assert.equal(h.calls[0].signal,controller.signal);
});
test('missing topic RPC fallback counts scanned rows so a false-positive page does not trap pagination',async()=>{
 const h=queries(call=>call.table==='get_posts_by_hashtag'?{data:null,error:{code:'PGRST202'}}:{data:Array.from({length:20},(_,i)=>({id:'p'+i,user_id:'u',content:'#topical'})),error:null});
 const {read}=compile(helpers+'\nexport const read=readTrendPage;',{supabase:h.client});const page=await read('#topic',20,new AbortController().signal,'token');
 assert.equal(page.rows.length,0);assert.equal(page.scanned,20);assert.deepEqual(h.calls[1].range,[20,39]);assert.equal(h.calls.length,2);
});
function topicRefresh(read,visible=()=>new Set(['known'])){
 const state={rows:[{id:'known',content:'Readable'}],loading:false,error:false,hasMore:true};
 const refs={postsRef:{current:state.rows},requestRef:{current:0},currentRoute:{current:{tag:'#topic'}},pendingMore:{current:false},refreshPending:{current:false},offsetRef:{current:40},hasMoreRef:{current:true},scrollTop:{current:400}};
 let activeScope='a';const cache=[];const set=k=>value=>{state[k]=value;};
 const globals={...refs,tag:'#topic',scope:'a',cacheKey:'topic:#topic',PAGE_SIZE:20,navigationScope:()=>activeScope,useCallback:fn=>fn,useAuthStore:{getState:()=>({session:{user:{id:'a'},access_token:'owner-token'}})},navigationCache:{load:(_scope,_key,loader)=>loader(new AbortController().signal),save:(...args)=>cache.push(args)},readTrendPage:read,reconcileFeedVisibility:visible,profileRead:promise=>Promise.resolve(promise),setLoading:set('loading'),setRefreshing:set('refreshing'),setLoadingMore:set('loadingMore'),setError:set('error'),setPosts:set('rows'),setHasMore:set('hasMore')};
 return{state,refs,cache,switchScope:()=>{activeScope='b';},run:compile(declaration('load')+'\nexport const run=load;',globals).run};
}
test('topic background refresh keeps loaded rows, cursor and scroll while deleting revoked retained rows',async()=>{
 const gate=deferred(),h=topicRefresh(()=>gate.promise);h.refs.postsRef.current.push({id:'revoked',content:'No longer accessible'});const pending=h.run(true);assert.equal(h.state.loading,false);assert.equal(h.state.rows[0].id,'known');
 gate.resolve({rows:[{id:'known',content:'Updated'}],scanned:20});await pending;assert.deepEqual(Array.from(h.state.rows,r=>r.id),['known']);assert.equal(h.state.rows[0].content,'Updated');assert.equal(h.refs.offsetRef.current,40);assert.equal(h.refs.scrollTop.current,400);assert.equal(h.state.hasMore,true);
});
test('failed or departed-account topic refresh cannot erase or replace a resolved list',async()=>{
 const h=topicRefresh(async()=>{throw Error('offline');});await h.run(true);assert.equal(h.state.error,true);assert.equal(h.state.rows[0].id,'known');assert.equal(h.state.loading,false);
 const gate=deferred(),old=topicRefresh(()=>gate.promise);const pending=old.run(true);old.switchScope();gate.resolve({rows:[{id:'stale'}],scanned:1});await pending;assert.equal(old.state.rows[0].id,'known');assert.equal(old.cache.length,0);
});
