import assert from 'node:assert/strict';
import {test} from 'node:test';
import os from 'node:os';
import {createTranscriptionWorker} from '../worker.mjs';
import {jobPlan,WorkerFailure} from '../protocol.mjs';
import {config,job} from './fixtures.mjs';
function fixture({reserved=false,cleanup=false}={}){
 const cfg={...config(),tempRoot:os.tmpdir()},item=job({cleanup}),events=[];
 const plan=jobPlan(item,cfg);if(reserved||cleanup)item.configuration_hash=plan.fingerprint;
 const call=(name,fn=()=>undefined)=>async(...args)=>{events.push({name,args});return fn(...args);};
 const api={claim:call('claim',()=>item),check:call('check',()=>true),source:call('source',()=>cfg.base+'/synthetic-signed-source'),submit:call('submit',()=>({ok:true})),
 defer:call('defer',()=>({ok:true})),settle:call('settle',()=>({ok:true})),finish:call('finish',()=>true),fail:call('fail',()=>({ok:true}))};
 const aws={get:call('get',()=>null),inputInfo:call('inputInfo',()=>({bytes:1024,sha256:'c'.repeat(64)})),putInput:call('putInput'),start:call('start',()=> 'IN_PROGRESS'),
 result:call('result',()=>({jobName:item.job_name,status:'COMPLETED',results:{items:[]}})),cleanup:call('cleanup')};
 const download=call('download'),encode=call('encode',()=>({bytes:1024,sha256:'c'.repeat(64),path:'/synthetic-only'}));
 return {cfg,item,plan,events,api,aws,call,names:()=>events.map(e=>e.name),drain:()=>createTranscriptionWorker({config:cfg,api,aws,download,encode}).drain(AbortSignal.timeout(1000))};
}
test('new work downloads, strips audio, reserves, rechecks rights and starts exactly once before deferring',async()=>{
 const h=fixture();const result=await h.drain();assert.equal(result.state,'deferred');
 assert.deepEqual(h.names(),['claim','check','get','source','download','check','encode','check','putInput','submit','check','start','check','defer']);
 assert.equal(h.events.find(x=>x.name==='submit').args[1],h.plan.fingerprint);assert.equal(h.events.find(x=>x.name==='start').args[0].request.TranscriptionJobName,h.item.job_name);
 assert.ok(!h.names().includes('settle'));assert.ok(!h.names().includes('cleanup'));
});
test('resuming a completed deterministic job uses no upload or Start and returns only a reviewed draft',async()=>{
 const h=fixture({reserved:true});h.aws.get=h.call('get',()=> 'COMPLETED');const result=await h.drain();
 assert.deepEqual(result,{state:'draft',cleanup_pending:false});assert.deepEqual(h.names(),['claim','check','get','check','result','check','finish','cleanup']);
 assert.equal(h.events.find(x=>x.name==='finish').args[1].jobName,h.item.job_name);
});
test('an ambiguous Start is reconciled only by GET of the same deterministic job and retains reservation',async()=>{
 const h=fixture();let reads=0;h.aws.get=h.call('get',()=>++reads===1?null:'IN_PROGRESS');h.aws.start=h.call('start',()=>{throw new WorkerFailure('AWS_START_AMBIGUOUS',true);});
 assert.equal((await h.drain()).state,'deferred');assert.equal(h.names().filter(x=>x==='start').length,1);assert.equal(h.names().filter(x=>x==='get').length,2);
 assert.ok(!h.names().includes('settle'));assert.ok(!h.names().includes('cleanup'));
 for(const e of h.events.filter(x=>['get','start'].includes(x.name)))assert.equal(e.args[0].request.TranscriptionJobName,h.item.job_name);
});
test('a still-absent job after ambiguous Start keeps its slot and never uses NOT_SUBMITTED',async()=>{
 const h=fixture();h.aws.start=h.call('start',()=>{throw new WorkerFailure('AWS_START_AMBIGUOUS',true);});
 assert.deepEqual(await h.drain(),{state:'deferred',code:'AWS_START_AMBIGUOUS'});assert.ok(!h.names().includes('settle'));assert.ok(!h.names().includes('fail'));assert.ok(!h.names().includes('cleanup'));
});
test('NOT_SUBMITTED is used only for a new reservation revoked before any Start attempt',async()=>{
 const h=fixture();let checks=0;h.api.check=h.call('check',()=>{if(++checks===4)throw new WorkerFailure('CLIP_CHANGED');return true;});
 assert.equal((await h.drain()).state,'revoked');assert.ok(!h.names().includes('start'));
 assert.equal(h.events.find(x=>x.name==='settle').args[1],'NOT_SUBMITTED');
 const old=fixture({reserved:true});let existingChecks=0;old.api.check=old.call('check',()=>{if(++existingChecks===2)throw new WorkerFailure('CLIP_CHANGED');return true;});
 assert.equal((await old.drain()).state,'revoked');assert.ok(!old.names().includes('start'));assert.ok(!old.names().includes('settle'));
});
test('an actual Start rejection never releases an unknown submission or retries with another name',async()=>{
 const h=fixture();h.aws.start=h.call('start',()=>{throw new WorkerFailure('AWS_REQUEST_REJECTED');});
 assert.deepEqual(await h.drain(),{state:'failed',code:'AWS_REQUEST_REJECTED'});assert.equal(h.names().filter(x=>x==='start').length,1);
 assert.ok(h.names().includes('fail'));assert.ok(!h.names().includes('settle'));assert.ok(!h.names().includes('cleanup'));
});
test('revocation before download grants no source, provider start, transcript or caption draft',async()=>{
 const h=fixture();h.api.check=h.call('check',()=>{throw new WorkerFailure('CLIP_CHANGED');});
 assert.equal((await h.drain()).state,'revoked');for(const name of ['source','download','encode','putInput','submit','start','finish'])assert.ok(!h.names().includes(name));
});
test('provider capacity or daily budget defers the same work without Start or releasing another slot',async()=>{
 for(const code of ['CAPACITY_LIMIT','DAILY_LIMIT']){const h=fixture();h.api.submit=h.call('submit',()=>{throw new WorkerFailure(code,true);});
 assert.deepEqual(await h.drain(),{state:'deferred',code});assert.ok(!h.names().includes('start'));assert.ok(!h.names().includes('settle'));assert.ok(!h.names().includes('fail'));}
});
test('cleanup holds an ambiguous absent job until broker grace expires and grants no media',async()=>{
 const h=fixture({cleanup:true});h.api.settle=h.call('settle',()=>{throw new WorkerFailure('CLEANUP_PENDING',true);});
 assert.deepEqual(await h.drain(),{state:'deferred',code:'CLEANUP_PENDING'});assert.deepEqual(h.names(),['claim','get','settle','defer']);
 const ready=fixture({cleanup:true});assert.equal((await ready.drain()).state,'cleaned');assert.deepEqual(ready.names(),['claim','get','settle','cleanup']);
});
test('cleanup polls an active provider job without deleting input; terminal cleanup is exact and grant-free',async()=>{
 const h=fixture({cleanup:true});h.aws.get=h.call('get',()=> 'IN_PROGRESS');assert.equal((await h.drain()).state,'deferred');assert.deepEqual(h.names(),['claim','get','defer']);
 const terminal=fixture({cleanup:true});terminal.aws.get=terminal.call('get',()=> 'COMPLETED');assert.equal((await terminal.drain()).state,'cleaned');assert.deepEqual(terminal.names(),['claim','get','cleanup','settle']);
 assert.equal(terminal.events.find(e=>e.name==='settle').args[1],'COMPLETED');
});
test('rights are rechecked after result retrieval, and failed scratch cleanup is surfaced after durable finish',async()=>{
 const revoked=fixture({reserved:true});revoked.aws.get=revoked.call('get',()=> 'COMPLETED');let n=0;revoked.api.check=revoked.call('check',()=>{if(++n===3)throw new WorkerFailure('CLIP_CHANGED');return true;});
 assert.equal((await revoked.drain()).state,'revoked');assert.ok(!revoked.names().includes('finish'));assert.ok(!revoked.names().includes('settle'));
 const h=fixture({reserved:true});h.aws.get=h.call('get',()=> 'COMPLETED');h.aws.cleanup=h.call('cleanup',()=>{throw new WorkerFailure('CLEANUP_PENDING',true);});
 assert.deepEqual(await h.drain(),{state:'draft',cleanup_pending:true});assert.ok(h.names().includes('finish'));
});
