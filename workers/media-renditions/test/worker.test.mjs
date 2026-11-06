import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {createWorker} from '../worker.mjs';
import {runJob} from '../run-job.mjs';
const owner='40000000-0000-4000-8000-000000000001',jid='40000000-0000-4000-8000-000000000002',lease='40000000-0000-4000-8000-000000000003',sid='40000000-0000-4000-8000-000000000004';
const job={job_id:jid,lease_id:lease,attempt:1,lease_until:new Date(Date.now()+900000).toISOString(),source_id:sid,source_version:'source-v1',source_bucket:'story-media',source_path:owner+'/source.mp4',source_owner:owner,source_bytes:4,source_etag:'source-etag',output_bucket:'adaptive-media',output_prefix:`${owner}/_renditions_v2/${jid}/${lease}/`,output_max_bytes:805306368,duration_max_seconds:600};
function harness(options={}){const calls=[],uploads=[];let sourceFile;const api={async rpc(name,args,signal){calls.push({name,args});if(name==='claim_media_rendition_cleanup_v2')return[];if(name==='claim_media_rendition_v2')return{...job,...options.job};if(name==='register_media_rendition_assets_v2'||name==='check_media_rendition_v2')return!options.revoked;return true;},async download(j,file){sourceFile=file;await writeFile(file,'abcd');},async upload(j,a,file){uploads.push({j,a,file});assert.equal((await readFile(file)).toString(),'data');if(options.uploadError)throw new Error('upstream_throttled');},async remove(){throw new Error('unexpected_remove');}};
 const encode=async(input,out,j,{signal})=>{if(options.encodeError)throw options.encodeError;if(options.hold)await options.hold(signal);await mkdir(out);await writeFile(path.join(out,'fallback.mp4'),'data');return{assets:[{name:'fallback.mp4',bytes:4,sha256:'a'.repeat(64),mime:'video/mp4'}],media:{width:640,height:360,duration:8}};};
 return{worker:createWorker(api,{encode,deadlineMs:options.deadlineMs||10000}),calls,uploads,get sourceFile(){return sourceFile;}};
}
test('worker orders lease proof, manifest registration, immutable upload and atomic publish, then removes local files',async()=>{const h=harness();assert.equal((await h.worker.drain()).state,'ready');const names=h.calls.map(c=>c.name);assert.ok(names.indexOf('register_media_rendition_assets_v2')<names.indexOf('finish_media_rendition_v2'));assert.equal(h.uploads[0].j.output_prefix,job.output_prefix);assert.notEqual(h.uploads[0].j.output_prefix,job.source_path);await assert.rejects(readFile(h.sourceFile),/ENOENT/);});
test('transient provider errors persist retry and permanent invalid inputs dead-letter',async()=>{for(const [options,outcome]of[[{uploadError:true},'retry'],[{encodeError:Object.assign(new Error('duration_budget'),{permanent:true})},'failed']]){const h=harness(options);assert.equal((await h.worker.drain()).state,outcome);assert.equal(h.calls.find(c=>c.name==='finish_media_rendition_v2').args.p_outcome,outcome);await assert.rejects(readFile(h.sourceFile),/ENOENT/);}});
test('source revocation prevents uploads for public and private media',async()=>{
 for(const source_bucket of ['story-media','chat-media','chat-files']){
  const h=harness({revoked:true,job:{source_bucket}});
  assert.equal((await h.worker.drain()).state,'retry');
  assert.equal(h.uploads.length,0);
  assert.equal(h.calls.find(c=>c.name==='finish_media_rendition_v2').args.p_error_code,'source_changed');
 }
});
test('valid private media uses the same fenced upload and publication path',async()=>{
 for(const source_bucket of ['chat-media','chat-files']){
  const h=harness({job:{source_bucket}});
  assert.equal((await h.worker.drain()).state,'ready');
  assert.equal(h.uploads.length,1);
  assert.equal(h.uploads[0].j.source_bucket,source_bucket);
  assert.ok(h.calls.some(c=>c.name==='check_media_rendition_v2'));
  assert.equal(h.calls.find(c=>c.name==='finish_media_rendition_v2').args.p_outcome,'ready');
  await assert.rejects(readFile(h.sourceFile),/ENOENT/);
 }
});
test('unsupported buckets and invalid private source paths never read the original',async()=>{
 for(const invalid of [
  {source_bucket:'unapproved-media'},
  {source_bucket:'chat-media',source_path:sid+'/source.mp4'},
  {source_bucket:'chat-files',source_path:owner+'/../source.mp4'},
 ]){
  const h=harness({job:invalid});
  assert.equal((await h.worker.drain()).state,'unavailable');
  assert.equal(h.sourceFile,undefined);
  assert.equal(h.uploads.length,0);
 }
});
test('one process owns at most one encoder and cancellation persists bounded retry',async()=>{let entered=false;const h=harness({deadlineMs:30,hold:signal=>new Promise((resolve,reject)=>{entered=true;signal.addEventListener('abort',()=>reject(new Error('worker_deadline')),{once:true});})});const work=h.worker.drain();while(!entered)await new Promise(r=>setTimeout(r,1));assert.equal((await h.worker.drain()).state,'busy');assert.equal((await work).state,'retry');assert.equal(h.calls.find(c=>c.name==='finish_media_rendition_v2').args.p_error_code,'worker_deadline');});
test('sequential batch removes each scratch directory before the next fenced worker claim',async()=>{
 const h=harness();let completed=0,lastSource;
 const exit=await runJob({async drain(signal){
  if(lastSource)await assert.rejects(readFile(lastSource),/ENOENT/);
  const result=await h.worker.drain(signal);completed++;lastSource=h.sourceFile;return result;
 }},{maxJobs:3});
 assert.equal(exit,0);assert.equal(completed,3);assert.equal(h.uploads.length,3);
 assert.equal(h.calls.filter(c=>c.name==='claim_media_rendition_v2').length,3);
 assert.equal(h.calls.filter(c=>c.name==='check_media_rendition_v2').length,3);
 assert.equal(new Set(h.uploads.map(x=>x.file)).size,3);
 await assert.rejects(readFile(lastSource),/ENOENT/);
});
