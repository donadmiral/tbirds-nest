const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const nodes=n=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(nodes):[n,...nodes(n.props?.children)];
const text=n=>typeof n==='string'?n:Array.isArray(n)?n.map(text).join(''):text(n?.props?.children??'');
const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../components/LiveGuestRequests.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
function harness(overrides={}){
 let props,tree,cursor=0,dirty=true,refreshes=0,joins=0,serial=0,authOwner=id(2);const slots=[],effects=[],commands=[],channels=[],events=new Map(),timers=new Map();
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((x,i)=>Object.is(x,b[i]));
 const hooks={useState(value){const i=cursor++;if(!(i in slots))slots[i]=typeof value==='function'?value():value;return[slots[i],next=>{slots[i]=typeof next==='function'?next(slots[i]):next;dirty=true;}];},useRef(value){return slots[cursor++]??={current:value};},useEffect(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps)){const old=slots[i];slots[i]={deps};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=fn();});}}};
 const document={hidden:false,addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name)};
 const client={auth:{getSession:async()=>({data:{session:{user:{id:authOwner},access_token:'test'}}})},realtime:{setAuth:async()=>{}},channel(topic,options){const channel={topic,options,removed:false,on(_kind,_filter,fn){this.callback=fn;return this;},subscribe(fn){this.status=fn;return this;}};channels.push(channel);return channel;},removeChannel:async channel=>{channel.removed=true;}};
 props={client,ownerId:id(2),scope:'1:owner',onRefresh:async()=>{refreshes++;},onJoin:()=>{joins++;},detail:{role:'viewer',session:{id:id(1),state:'live'},guest_topic:`live-guests:${id(1)}:${id(2)}`,join_requests:[],own_join_request:null,stage:{limit:12,occupied:1,available:11},can_request_join:true,...overrides}};
 const module={exports:{}};const jsx=(type,props)=>({type,props});vm.runInNewContext(code,{module,exports:module.exports,require:name=>({react:hooks,'react/jsx-runtime':{jsx,jsxs:jsx},'@/lib/liveApi':{record:value=>!!value&&typeof value==='object',liveError:e=>e.message,liveCommand:(_client,_id,action,payload,requestId)=>{const command={...deferred(),action,payload,requestId};commands.push(command);return command.promise;}}}[name]),document,window:{addEventListener:(n,f)=>events.set(n,f),removeEventListener:n=>events.delete(n)},crypto:{randomUUID:()=>id(++serial+100)},setInterval:fn=>{timers.set(++serial,fn);return serial;},clearInterval:n=>timers.delete(n)});
 function render(){cursor=0;dirty=false;tree=module.exports.LiveGuestRequests(props);return tree;}
 async function flush(){for(let n=0;n<15;n++){if(dirty)render();effects.splice(0).forEach(fn=>fn());await new Promise(r=>setImmediate(r));if(!dirty&&!effects.length)return;}throw Error('Unstable render');}
 return{flush,commands,channels,events,document,client,get tree(){return tree;},get refreshes(){return refreshes;},get joins(){return joins;},button(label){return nodes(tree).find(n=>n.type==='button'&&(text(n)===label||n.props['aria-label']===label));},click(label){const b=this.button(label);assert.ok(b,label);if(!b.props.disabled)b.props.onClick();},update(detail,other={}){props={...props,...other,detail:{...props.detail,...detail}};dirty=true;},authOwner(value){authOwner=value;},cleanup(){slots.forEach(s=>s?.cleanup?.());}};
}
test('request/cancel/accepted flow never opens camera until the explicit Join camera click',async()=>{
 const h=harness();await h.flush();assert.equal(h.joins,0);const button=h.button('Request to join');button.props.onClick();button.props.onClick();await h.flush();assert.equal(h.commands.length,1);assert.equal(h.commands[0].action,'request_join');assert.equal(h.joins,0);
 h.commands[0].resolve({ok:true});await h.flush();assert.equal(h.refreshes,1);
 h.update({own_join_request:{status:'pending'},can_request_join:false});await h.flush();h.click('Cancel request');assert.equal(h.commands[1].action,'cancel_join_request');h.commands[1].resolve({ok:true});await h.flush();
 h.update({role:'guest',own_join_request:{status:'accepted'}});await h.flush();assert.equal(h.joins,0);h.click('Join camera');assert.equal(h.joins,1);h.cleanup();
});
test('host queue honors capacity and keeps accept/decline commands scoped to the selected viewer',async()=>{
 const person={user_id:id(3),status:'pending',profile:{full_name:'Guest'}};const h=harness({role:'host',join_requests:[person],stage:{limit:2,occupied:2,available:0}});await h.flush();assert.equal(h.button('Accept Guest').props.disabled,true);assert.equal(h.button('Decline Guest').props.disabled,false);
 h.click('Decline Guest');await h.flush();assert.equal(h.commands[0].action,'decline_join_request');assert.equal(h.commands[0].payload.user_id,id(3));h.commands[0].resolve({ok:true});await h.flush();h.update({stage:{limit:2,occupied:1,available:1}});await h.flush();h.click('Accept Guest');assert.equal(h.commands[1].action,'accept_join_request');h.commands[1].resolve({ok:true});await h.flush();h.cleanup();
});
test('failed request retries keep one idempotency identity and old account completions cannot change the new screen',async()=>{
 const h=harness();await h.flush();h.click('Request to join');h.commands[0].reject(Error('Offline'));await h.flush();assert.match(text(h.tree),/Offline/);h.click('Request to join');assert.equal(h.commands[0].requestId,h.commands[1].requestId);
 h.update({}, {scope:'2:other',ownerId:id(4)});await h.flush();h.commands[1].reject(Error('Old account error'));await h.flush();assert.doesNotMatch(text(h.tree),/Old account error/);assert.equal(h.button('Request to join').props.disabled,false);h.cleanup();
});
test('private guest updates refresh only the current owner and stale or hidden channels are ignored',async()=>{
 const h=harness();await h.flush();assert.equal(h.channels.length,1);const old=h.channels[0];assert.equal(old.options.config.private,true);old.callback({payload:{session_id:id(1)}});assert.equal(h.refreshes,1);old.callback({payload:{session_id:id(9)}});assert.equal(h.refreshes,1);
 h.document.hidden=true;h.events.get('visibilitychange')();assert.equal(old.removed,true);old.callback({payload:{session_id:id(1)}});assert.equal(h.refreshes,1);
 h.document.hidden=false;h.events.get('visibilitychange')();await h.flush();assert.equal(h.channels.length,2);h.update({}, {scope:'2:other',ownerId:id(4)});await h.flush();h.channels[1].callback({payload:{session_id:id(1)}});assert.equal(h.refreshes,2);h.cleanup();
});
test('a foreign guest topic is never subscribed and a terminal stream exposes no join actions',async()=>{
 const h=harness({guest_topic:`live-guests:${id(1)}:${id(8)}`});await h.flush();assert.equal(h.channels.length,0);h.update({session:{id:id(1),state:'ended'}});await h.flush();assert.equal(h.tree,null);h.cleanup();
});
