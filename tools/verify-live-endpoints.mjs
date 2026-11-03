// Hosted startup/authentication smoke check. No account or service credentials.
// Provider operation, authenticated playback and capacity require separate proof.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const origin=new URL(process.argv[2]);
assert.match(origin.hostname,/^[a-z]{20}\.supabase\.co$/);
assert.equal(origin.protocol,'https:');
assert.equal(origin.pathname,'/');
const names=['live-stage','live-control','live-playback','live-cover','live-maintenance','live-sign','live-clip-media','live-clip-worker','live-provider-webhook','content-media-sign','media-content'];
const checks=await Promise.all(names.map(async name=>{
 const payload={sessionId:randomUUID(),clipId:randomUUID(),format:'horizontal',requestId:randomUUID(),action:name==='live-control'?'start':'authorize',references:[]};
 const result=await fetch(new URL('/functions/v1/'+name,origin),{method:name==='media-content'?'GET':'POST',headers:{'Content-Type':'application/json'},...(name==='media-content'?{}:{body:JSON.stringify(name==='live-provider-webhook'?{}:payload)}),signal:AbortSignal.timeout(30000),redirect:'error'});
 const text=await result.text();let body;try{body=JSON.parse(text);}catch{body={error:text.slice(0,100)};}
 const allowed=name==='media-content'?[403]:name==='live-provider-webhook'?[401,503]:[401];
 assert.ok(allowed.includes(result.status),`${name}: ${result.status} ${JSON.stringify(body)}`);
 assert.ok(!text.includes('BOOT_ERROR')&&!text.includes('WORKER_ERROR'),name+': worker startup');
 const cache=result.headers.get('cache-control');assert.match(cache||'',/no-store/);
 return {function:name,status:result.status,error:body.error,cache_control:cache};
}));
const receipt={project:origin.hostname.split('.')[0],checked_at:new Date().toISOString(),checks,passed:checks.length,scope:'Hosted startup, unauthenticated rejection and private caching only; no provider or load-test acceptance.'};
if(process.argv[3])await writeFile(process.argv[3],JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(receipt,null,2));
