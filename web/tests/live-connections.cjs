const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const record=v=>!!v&&typeof v==='object'&&!Array.isArray(v),plain=v=>JSON.parse(JSON.stringify(v));
function evaluate(file,imports,globals={}){const module={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{module,exports:module.exports,require:name=>{if(Object.hasOwn(imports,name))return imports[name];throw Error(name);},URL,Date,Error,JSON,...globals});return module.exports;}
const helpers=evaluate('lib/liveConnections.ts',{'./liveApi':{record,liveInvoke:async(client,name,body)=>client(name,body)}});
const origin='https://platinumcircles.example',state='a'.repeat(43),owner='00000000-0000-4000-8000-000000000001';
const authUrl=()=>`https://x.com/i/oauth2/authorize?state=${state}&redirect_uri=${encodeURIComponent(origin+'/live/connections/callback')}`;
test('OAuth navigation permits only reviewed provider origin, path and same-origin callback',()=>{
 assert.equal(helpers.validAuthorizationUrl(authUrl(),'x',origin).origin,'https://x.com');
 for(const url of [authUrl().replace('x.com','x.com.evil.example'),authUrl().replace('/i/oauth2/authorize','/other'),authUrl().replace(encodeURIComponent(origin),encodeURIComponent('https://evil.example')),authUrl()+'#token',authUrl().replace('https://','https://user@'),authUrl().replace(state,'x')])assert.throws(()=>helpers.validAuthorizationUrl(url,'x',origin));
});
test('connection UI needs both real application availability and database enablement',async()=>{
 const rows=await helpers.connectionStatus(async()=>({available:['x'],items:[{platform:'x',enabled:true,state:'connected',account_name:'Creator',can_publish:false},{platform:'youtube',enabled:true},{platform:'tiktok',enabled:false},{platform:'unknown',enabled:true}]}));assert.equal(rows.length,3);assert.equal(rows[0].enabled,true);assert.equal(rows[1].enabled,false);assert.equal(rows[2].enabled,false);assert.equal(rows[0].can_publish,false);
});
test('account selection is bounded and strips tokens or unexpected provider fields',()=>{
 const parsed=helpers.parseConnectionSelection({state:'select_account',selection_id:owner,accounts:[{id:'account_1',name:'Creator',access_token:'secret'},{id:'https://evil.example',name:'Bad'}]});assert.deepEqual(plain(parsed),{id:owner,accounts:[{id:'account_1',name:'Creator'}]});
 assert.equal(helpers.parseConnectionSelection({state:'connected'}),null);
});
test('all connection error messages are user-facing and omit raw provider text',()=>{for(const code of ['STATE_REPLAYED','AUTH_REQUIRED','INTEGRATION_DISABLED','SCOPES_NOT_GRANTED','PROVIDER_RATE_LIMITED','SECRET_CANARY']){const message=helpers.connectionError(new Error(code));assert.ok(message.length>20);assert.ok(!message.includes('SECRET_CANARY'));}});
const children=v=>Array.isArray(v)?v.flatMap(children):v&&typeof v==='object'?[v,...children(v.props?.children)]:[];
const text=v=>Array.isArray(v)?v.map(text).join(''):typeof v==='string'||typeof v==='number'?String(v):text(v?.props?.children||'');
function harness(options={}){
 let snapshot={owner,scope:'one',initialized:true,...options.identity},cursor=0,dirty=false,tree,component;const slots=[],effects=[],calls=[],order=[],storage=new Map();
 if(options.stored!==false)storage.set('platinum-live-oauth-attempt',JSON.stringify({platform:'x',state,owner,createdAt:Date.now(),...options.stored}));
 const window={location:{href:origin+'/live/connections/callback?code=CODE_CANARY&state='+state,origin,assign:url=>{order.push('navigate');calls.push({navigation:url});}},history:{replaceState:()=>{order.push('strip_url');window.location.href=origin+'/live/connections/callback';}}};
 const sessionStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
 const equal=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 const hooks={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],next=>{const result=typeof next==='function'?next(slots[i]):next;if(result!==slots[i]){slots[i]=result;dirty=true;}}];},useRef(initial){const i=cursor++;return slots[i]??={current:initial};},useCallback(fn,deps){const i=cursor++;if(!equal(slots[i]?.deps,deps))slots[i]={value:fn,deps};return slots[i].value;},useSyncExternalStore(){cursor++;return snapshot;},useEffect(fn,deps){const i=cursor++,old=slots[i];if(equal(old?.deps,deps))return;const entry={deps,fn};slots[i]=entry;effects.push(()=>{old?.cleanup?.();entry.cleanup=fn();});}};
 const invoke=async(client,name,body)=>{order.push('invoke');calls.push(body);return options.invoke?options.invoke(body):body.action==='status'?{available:[],items:[]}:{state:'connected'};};
 const realHelpers=evaluate('lib/liveConnections.ts',{'./liveApi':{record,liveInvoke:invoke}}),client={};
 const exports=evaluate('components/LiveConnections.tsx',{react:hooks,'react/jsx-runtime':{jsx:(type,props,key)=>({type,props,key}),jsxs:(type,props,key)=>({type,props,key})},'next/link':{default:'a'},'lucide-react':{ArrowLeft:'icon',ExternalLink:'icon',Link2:'icon',RefreshCw:'icon'},'@/lib/supabase/client':{createClient:()=>client},'@/lib/navigationCache':{getNavigationStore:()=>({subscribe(){},getSnapshot(){},getServerSnapshot(){}})},'@/lib/liveApi':{record,liveInvoke:invoke},'@/lib/liveConnections':realHelpers},{window,sessionStorage});
 const render=()=>{let n=0;do{dirty=false;cursor=0;tree=component();while(effects.length)effects.shift()();assert.ok(++n<20);}while(dirty);return tree;};
 return{calls,order,storage,window,mount(name='LiveConnectionCallback'){component=exports[name];render();},render,async flush(){for(let i=0;i<6;i++){await new Promise(setImmediate);render();}},auth(next){snapshot={...snapshot,...next};render();},strictReplay(){for(const slot of slots)if(slot?.fn){slot.cleanup?.();slot.cleanup=slot.fn();}render();},get text(){return text(render());},get nodes(){return children(render());}};
}
test('callback strips authorization code before provider exchange and submits only one request under Strict Mode',async()=>{
 const h=harness();h.mount();h.strictReplay();await h.flush();assert.deepEqual(h.order.slice(0,2),['strip_url','invoke']);assert.equal(h.calls.filter(c=>c.action==='complete').length,1);assert.equal(h.window.location.href.includes('CODE_CANARY'),false);assert.equal(h.storage.size,0);assert.match(h.text,/No clip has been posted/);
});
test('callback waits for restored auth; mismatched owner or expired state never exchanges code',async()=>{
 const pending=harness({identity:{owner:null,initialized:false}});pending.mount();await pending.flush();assert.equal(pending.calls.length,0);pending.auth({owner,initialized:true,scope:'restored'});await pending.flush();assert.equal(pending.calls.length,1);
 for(const options of [{identity:{owner:'other'}},{stored:{createdAt:Date.now()-700000}},{stored:false}]){const h=harness(options);h.mount();await h.flush();assert.equal(h.calls.length,0);assert.match(h.text,/not completed/);}
});
test('account-switch cleanup rejects late account-selection response',async()=>{
 let resolve;const h=harness({invoke:()=>new Promise(r=>{resolve=r;})});h.mount();h.auth({owner:'different-owner',scope:'two'});resolve({state:'select_account',selection_id:owner,accounts:[{id:'one',name:'Private account name'}]});await h.flush();assert.ok(!h.text.includes('Private account name'));assert.equal(h.calls.length,1);
});
test('connection page shows no connect controls when applications are unavailable',async()=>{const h=harness();h.mount('LiveConnections');await h.flush();assert.equal(h.nodes.filter(n=>n.type==='button'&&text(n).trim()==='Connect').length,0);assert.match(h.text,/Connection setup is not available yet/);});
test('selection requires user click and no callback action publishes a post',async()=>{const h=harness({invoke:async body=>body.action==='complete'?{state:'select_account',selection_id:owner,accounts:[{id:'page_1',name:'My Page'}]}:{state:'connected'}});h.mount();await h.flush();assert.equal(h.calls.length,1);const button=h.nodes.find(n=>n.type==='button'&&text(n)==='My Page');assert.ok(button);await button.props.onClick();await h.flush();assert.equal(h.calls[1].action,'select');assert.equal(h.calls[1].account_id,'page_1');assert.ok(h.calls.every(c=>!String(c.action).includes('publish')));});
