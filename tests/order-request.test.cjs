const test = require('node:test');
const assert = require('node:assert/strict');
const {createOrderRequest,orderTimeout,orderRejected}=require('../shared/orderRequest.ts');
const {marketOrderSearch,marketOrdersHref}=require('../admin-web/lib/marketOrders.ts');
test('an uncertain create retry preserves the original actor, payload and request identity',()=>{
 const request=createOrderRequest();let keys=0;
 const first=request.get({actor:'buyer-a',quantity:1,instructions:'Pickup'},()=>String(++keys));
 const second=request.get({actor:'buyer-b',quantity:4,instructions:'Changed'},()=>String(++keys));
 assert.equal(second,first);assert.equal(second.actor,'buyer-a');assert.equal(second.quantity,1);assert.equal(keys,1);
 request.clear();assert.equal(request.pending,false);assert.equal(request.get({actor:'buyer-b'},()=>String(++keys)).p_request_key,'2');
});
test('deadline exits a stalled request but does not pretend to cancel a possible server commit',async()=>{
 let finish;const underlying=new Promise(resolve=>finish=resolve);
 await assert.rejects(orderTimeout(underlying,5),/ORDER_TIMEOUT/);finish('committed');assert.equal(await underlying,'committed');
 assert.equal(await orderTimeout(Promise.resolve('ready'),50),'ready');
});
test('only definite database rejections discard a create retry identity',()=>{
 assert.equal(orderRejected({code:'P0001'}),true);assert.equal(orderRejected({code:'42501'}),true);
 for(const error of [new Error('offline'),{code:'500'},null,{code:'PGRST301'}])assert.equal(orderRejected(error),false);
});
test('admin order search preserves a valid paired cursor and rejects partial or injected values',()=>{
 const id='10000000-0000-4000-8000-000000000001',created_at='2026-10-22T12:00:00.000Z';
 assert.deepEqual(marketOrderSearch({status:'disputed',before:created_at,id}),{status:'disputed',before:created_at,id});
 assert.equal(marketOrderSearch({status:'invented',before:created_at}).status,'any');
 assert.equal(marketOrderSearch({before:created_at,id:'x'}).before,null);
 assert.equal(marketOrderSearch({before:['x'],id}).id,null);
 const url=new URL(marketOrdersHref('disputed',{created_at,id}),'https://admin.test');assert.equal(url.searchParams.get('id'),id);assert.equal(url.searchParams.get('status'),'disputed');
});
const {createScopedMutation}=require('../shared/scopedMutation.ts');
test('repeated community actions share a lock and old-account completion cannot unlock the new account',async()=>{
 const queue=createScopedMutation();let oldDone,newDone;
 const old=queue.run('join',()=>new Promise(resolve=>oldDone=resolve));
 assert.equal((await queue.run('join',()=>{throw new Error('must not dispatch');})).stale,true);
 queue.reset();const current=queue.run('join',()=>new Promise(resolve=>newDone=resolve));
 oldDone({data:'old'});assert.equal((await old).stale,true);
 assert.equal((await queue.run('join',()=>{throw new Error('new-account lock lost');})).stale,true);
 newDone({data:'joined',error:null});assert.equal((await current).data,'joined');
 assert.equal((await queue.run('join',async()=>({data:'next',error:null}))).data,'next');
});
test('community transport rejection returns a recoverable error and releases only its own action',async()=>{
 const queue=createScopedMutation();const failed=await queue.run('remove',async()=>{throw new Error('network unavailable');});
 assert.equal(failed.stale,false);assert.equal(failed.error.message,'network unavailable');assert.equal((await queue.run('remove',async()=>({data:'confirmed',error:null}))).data,'confirmed');
});
