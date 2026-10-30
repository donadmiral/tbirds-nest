const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const ts=require('typescript');
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const text=n=>typeof n==='string'||typeof n==='number'?String(n):Array.isArray(n)?n.map(text).join(''):text(n?.props?.children??'');
const order=user=>({id:'o-'+user,buyer_id:user,seller_id:'seller',listing_id:'listing',conversation_id:null,title:'Order of '+user,quantity:1,total_minor:'1234',currency:'USD',fulfilment:'pickup',status:'requested',created_at:'2026-10-23T00:00:00Z',instructions:''});
function app(options={}){
 let uid='buyer-a',auth,initial=true,cursor=0,tree;const slots=[],effects=[],calls=[];
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((x,i)=>Object.is(x,b[i]));
 const hooks={useState(seed){const i=cursor++;if(!(i in slots))slots[i]=typeof seed==='function'?seed():seed;return[slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},useRef(seed){return slots[cursor++]??={current:seed};},useCallback(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps))slots[i]={deps,fn};return slots[i].fn;},useEffect(fn,deps){const i=cursor++;if(!slots[i]||!same(slots[i].deps,deps)){slots[i]?.cleanup?.();slots[i]={deps};effects.push(()=>slots[i].cleanup=fn());}}};
 const client={auth:{getSession:()=>{if(initial&&options.initial){initial=false;return options.initial.promise;}return Promise.resolve({data:{session:{user:{id:uid}}},error:null});},onAuthStateChange:fn=>{auth=fn;return{data:{subscription:{unsubscribe(){}}}};}},rpc:async(name,args)=>{calls.push({name,args});if(name==='get_market_orders')return{data:{rows:[order(uid)],next_cursor:null,has_more:false},error:null};return options.rpc?options.rpc(name,args):{data:{},error:null};}};
 const module={exports:{}};const source=fs.readFileSync(path.join(__dirname,'../components/MarketOrders.tsx'),'utf8');
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{module,exports:module.exports,Date,Error,console,queueMicrotask,crypto:require('node:crypto').webcrypto,window:{confirm:()=>true,prompt:()=>''},require(id){if(id==='react')return hooks;if(id==='react/jsx-runtime'){const jsx=(type,props)=>({type,props:type==='Dialog'?{...props,children:props.open?props.children:null}:props});return{jsx,jsxs:jsx};}if(id==='lucide-react')return new Proxy({},{get:(_t,key)=>String(key)});if(id==='@/components/ProductDialog')return{ProductDialog:'Dialog'};if(id.endsWith('.module.css'))return{default:new Proxy({},{get:(_t,key)=>String(key)})};if(id==='next/link')return{default:'Link'};if(id==='@/lib/supabase/client')return{createClient:()=>client};if(id.endsWith('/marketOrders'))return require('../../shared/marketOrders.ts');if(id.endsWith('/orderRequest'))return require('../../shared/orderRequest.ts');throw new Error(id);}});
 const render=()=>{cursor=0;tree=module.exports.MarketOrders({listing:{id:'listing',seller_id:'seller',status:'available',stock_quantity:3}});effects.splice(0).forEach(fn=>fn());};
 const nodes=()=>{const all=[];const walk=n=>{if(!n||typeof n!=='object')return;if(Array.isArray(n))return n.forEach(walk);all.push(n);walk(n.props?.children);};walk(tree);return all;};
 const flush=async()=>{for(let i=0;i<6;i++){await new Promise(setImmediate);render();}};
 return{render,flush,calls,emit(next){uid=next;auth('SIGNED_IN',{user:{id:uid}});render();},submit(){nodes().find(n=>n.type==='form').props.onSubmit({preventDefault(){}});render();const confirm=nodes().find(n=>n.type==='button'&&text(n)==='Request order');if(confirm&&!confirm.props.disabled)confirm.props.onClick();render();},review(){nodes().find(n=>n.type==='form').props.onSubmit({preventDefault(){}});render();},button(label){return nodes().find(n=>n.type==='button'&&text(n).includes(label));},get text(){return text(tree);},unmount(){slots.forEach(s=>s?.cleanup?.());}};
}
test('late initial session cannot replace a newer account and its orders',async()=>{
 const initial=defer(),a=app({initial});a.render();a.emit('buyer-b');await a.flush();initial.resolve({data:{session:{user:{id:'buyer-a'}}},error:null});await a.flush();assert.match(a.text,/Order of buyer-b/);assert.doesNotMatch(a.text,/Order of buyer-a/);a.unmount();
});
test('lost create response retries the exact immutable request identity',async()=>{
 let attempt=0;const a=app({rpc:async()=>{if(++attempt===1)throw new Error('lost response');return{data:{},error:null};}});a.render();await a.flush();a.submit();await a.flush();assert.match(a.text,/Retry same order request/);a.submit();await a.flush();const calls=a.calls.filter(c=>c.name==='create_market_order');assert.equal(calls.length,2);assert.deepEqual(calls[0].args,calls[1].args);a.unmount();
});
test('old-account completion cannot unlock a new-account mutation',async()=>{
 const old=defer(),next=defer();const a=app({rpc:(_n,args)=>args.p_expected_user==='buyer-a'?old.promise:next.promise});a.render();await a.flush();a.submit();await a.flush();a.emit('buyer-b');await a.flush();a.submit();await a.flush();old.resolve({data:{},error:null});await a.flush();assert.equal(a.button('Retry same order request').props.disabled,true);next.resolve({data:{},error:null});await a.flush();assert.equal(a.button('Review order request').props.disabled,false);assert.match(a.text,/Order of buyer-b/);a.unmount();
});
test('history transport errors are visible and do not leave controls locked',async()=>{
 const a=app({rpc:async()=>{throw new Error('offline');}});a.render();await a.flush();a.button('History').props.onClick();await a.flush();assert.match(a.text,/Could not update the order/i);assert.equal(a.button('History').props.disabled,false);a.unmount();
});

test('reviewing and cancelling an order request makes no order mutation',async()=>{
 const a=app();a.render();await a.flush();a.review();await a.flush();assert.equal(a.calls.filter(c=>c.name==='create_market_order').length,0);a.button('Edit request').props.onClick();a.render();assert.equal(a.calls.filter(c=>c.name==='create_market_order').length,0);a.unmount();
});
