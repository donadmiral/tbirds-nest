import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Readable} from 'node:stream';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {awsOperations,validateRemoteJob} from '../aws.mjs';
import {jobPlan,digest,LIMITS} from '../protocol.mjs';
import {config,job,remote,missing,failure} from './fixtures.mjs';
const plan=jobPlan(job(),config());
const setup=({s3=async()=>({}),transcribe=async()=>({TranscriptionJob:remote(plan)})}={})=>{
 const calls=[];const client=(name,fn)=>({send:async(command,options)=>{calls.push({name,type:command.constructor.name,input:command.input,options});return fn(command,options);}});
 return{calls,aws:awsOperations(config(),{s3:client('s3',s3),transcribe:client('transcribe',transcribe)})};
};
test('SDK Start/Get use deterministic job, exact private keys, fixed role and no AWS subtitle write',async()=>{
 const h=setup();assert.equal(await h.aws.get(plan),'IN_PROGRESS');assert.equal(await h.aws.start(plan),'IN_PROGRESS');
 assert.deepEqual(h.calls.map(c=>c.type),['GetTranscriptionJobCommand','StartTranscriptionJobCommand']);assert.deepEqual(h.calls[0].input,{TranscriptionJobName:job().job_name});
 assert.deepEqual(h.calls[1].input,plan.request);assert.equal(h.calls[1].input.Subtitles,undefined);assert.equal(h.calls[1].input.OutputKey,`transcription/${job().id}/result.json`);
});
test('Get absent uses the exact known not-found shape; permissions or other invalid requests never become Start permission',async()=>{
 const absent=setup({transcribe:async()=>{throw missing();}});assert.equal(await absent.aws.get(plan),null);
 for(const error of [Object.assign(new Error('S3 bucket cannot be accessed'),{name:'BadRequestException'}),Object.assign(new Error('forbidden secret'),{name:'AccessDeniedException'}),new Error('network token')]){
 const h=setup({transcribe:async()=>{throw error;}});await assert.rejects(h.aws.get(plan),e=>['AWS_ACCESS_DENIED','AWS_UNAVAILABLE'].includes(e.code)&&!e.message.includes('secret'));
 }
});
test('remote provider job must match full fixed source, role, language and configuration tags',()=>{
 assert.equal(validateRemoteJob({...remote(plan,'COMPLETED'),Transcript:{TranscriptFileUri:'https://untrusted.invalid/private-token'},FailureReason:'do not echo'},plan),'COMPLETED');
 for(const changed of [{Media:{MediaFileUri:'s3://foreign-bucket/file'}},{JobExecutionSettings:{...plan.request.JobExecutionSettings,AllowDeferredExecution:true}},
 {LanguageCode:'de-DE'},{Tags:[{Key:'Service',Value:'PlatinumLiveCaptions'},{Key:'ConfigurationHash',Value:'b'.repeat(64)}]},{TranscriptionJobName:'other'}])assert.throws(()=>validateRemoteJob({...remote(plan),...changed},plan),failure('AWS_CONFIGURATION_CONFLICT'));
});
test('Start conflict/transport is ambiguous, explicit request or access rejection is sanitized',async()=>{
 const cases=[['ConflictException','AWS_START_AMBIGUOUS'],['TimeoutError','AWS_START_AMBIGUOUS'],['BadRequestException','AWS_REQUEST_REJECTED'],['AccessDeniedException','AWS_ACCESS_DENIED']];
 for(const[name,code]of cases){const h=setup({transcribe:async()=>{throw Object.assign(new Error('private raw provider message'),{name});}});await assert.rejects(h.aws.start(plan),e=>e.code===code&&!e.message.includes('private'));}
});
test('conditional S3 upload is AES256, owner-bound and reconciles only identical audio after lost response',async()=>{
 const folder=await mkdtemp(path.join(os.tmpdir(),'caption-sdk-'));try{
 const file=path.join(folder,'source.flac'),bytes=Buffer.alloc(1024,7);await writeFile(file,bytes);const audio={path:file,bytes:bytes.length,sha256:digest(bytes)};
 const h=setup({s3:async(command)=>{if(command.constructor.name==='PutObjectCommand')throw Object.assign(new Error('ambiguous response'),{name:'TimeoutError'});
 return{ContentLength:audio.bytes,Metadata:{'transcription-id':plan.id,'configuration-hash':plan.fingerprint,'audio-sha256':audio.sha256}};}});
 await h.aws.putInput(plan,audio);assert.deepEqual(h.calls.map(x=>x.type),['PutObjectCommand','HeadObjectCommand']);
 const sent=h.calls[0].input;assert.equal(sent.IfNoneMatch,'*');assert.equal(sent.ServerSideEncryption,'AES256');assert.equal(sent.ExpectedBucketOwner,config().accountId);assert.equal(sent.Key,plan.input);assert.equal(sent.ChecksumSHA256,Buffer.from(audio.sha256,'hex').toString('base64'));
 const mismatch=setup({s3:async()=>({ContentLength:audio.bytes,Metadata:{'transcription-id':plan.id,'configuration-hash':plan.fingerprint,'audio-sha256':'d'.repeat(64)}})});
 await assert.rejects(mismatch.aws.inputInfo({...plan,fingerprint:'0'.repeat(64)}),failure('AWS_INPUT_CONFLICT'));
 }finally{await rm(folder,{recursive:true,force:true});}
});
test('result reads only the predetermined result.json; oversized or wrong job output is rejected',async()=>{
 const result={jobName:job().job_name,status:'COMPLETED',results:{items:[{type:'pronunciation',start_time:'0.0',end_time:'0.2',alternatives:[{content:'Synthetic'}]}]}};
 const data=Buffer.from(JSON.stringify(result));const h=setup({s3:async()=>({ContentLength:data.length,Body:Readable.from([data])})});
 assert.deepEqual(await h.aws.result(plan),result);assert.equal(h.calls[0].input.Key,plan.output);assert.equal(h.calls[0].input.ExpectedBucketOwner,config().accountId);
 const large=setup({s3:async()=>({ContentLength:LIMITS.resultBytes+1,Body:Readable.from([])})});await assert.rejects(large.aws.result(plan),failure('MEDIA_TOO_LARGE'));
 const wrong=setup({s3:async()=>({Body:Readable.from([Buffer.from(JSON.stringify({...result,jobName:'foreign'}))])})});await assert.rejects(wrong.aws.result(plan),failure('RESULT_INVALID'));
});
test('cleanup deletes exactly two reserved scratch objects and surfaces partial failures',async()=>{
 const h=setup();await h.aws.cleanup(plan);assert.deepEqual(h.calls[0].input,{Bucket:config().bucket,ExpectedBucketOwner:config().accountId,Delete:{Objects:[{Key:plan.input},{Key:plan.output}],Quiet:true}});
 const bad=setup({s3:async()=>({Errors:[{Key:plan.input,Message:'private text'}]})});await assert.rejects(bad.aws.cleanup(plan),failure('CLEANUP_PENDING'));
});
