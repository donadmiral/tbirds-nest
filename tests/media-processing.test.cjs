const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.join(__dirname,'../supabase/functions');
function load(relative){const filename=path.resolve(root,relative),exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Request,Response,Headers,URL,ReadableStream,AbortController,AbortSignal,Uint8Array,DataView,TextEncoder,TextDecoder,crypto:require('node:crypto').webcrypto,setTimeout,clearTimeout,atob,require:r=>load(path.relative(root,path.resolve(path.dirname(filename),r)))});return exports;}
const {readAdmittedMedia}=load('faststart-video/boundedRead.ts'),{faststartRemux}=load('faststart-video/remux.ts'),{createDurableFaststartHandler}=load('faststart-video/durable.ts');
const id=n=>`40000000-0000-4000-8000-${String(n).padStart(12,'0')}`,owner=id(1),jobid=id(2),lease=id(3),object=id(4),serviceKey='sb_secret_synthetic_fixture_not_a_real_key_123456';
const box=(type,data=Buffer.alloc(0))=>{const result=Buffer.alloc(data.length+8);result.writeUInt32BE(result.length);result.write(type,4);data.copy(result,8);return result;};
const ftyp=box('ftyp',Buffer.from('isom0000')),mdat=box('mdat',Buffer.from('media payload is never changed'));
function moov(offsets,width=4){const payload=Buffer.alloc(8+width*offsets.length);payload.writeUInt32BE(offsets.length,4);offsets.forEach((v,i)=>width===4?payload.writeUInt32BE(v,8+i*width):payload.writeBigUInt64BE(BigInt(v),8+i*width));return box('moov',box('trak',box('mdia',box('minf',box('stbl',box(width===4?'stco':'co64',payload))))));}
const index=moov([ftyp.length+8]),video=Buffer.concat([ftyp,mdat,index]);
const job={job_id:jobid,lease_id:lease,attempt:1,lease_until:new Date(Date.now()+90000).toISOString(),source_id:object,source_version:'v1',source_bucket:'story-media',source_path:owner+'/original.mp4',source_bytes:video.length,source_etag:'source-etag',source_mime:'video/mp4',output_bucket:'derived-media',output_path:owner+'/_derived_v1/'+jobid+'/'+lease+'.mp4'};
const stream=(chunks,opts={})=>new Response(new ReadableStream({start(c){chunks.forEach(x=>c.enqueue(new Uint8Array(x)));if(!opts.stall)c.close();},cancel(){opts.cancel?.();}}),{headers:{ETag:'"source-etag"',...opts.headers}});
function harness(options={}){const calls=[],uploads=[],reads=[];let claims=0;const handler=createDurableFaststartHandler({serviceKey,deadlineMs:options.deadlineMs,maxJobs:options.maxJobs,authorizeLegacyService:options.legacy,
 async rpc(name,args){calls.push({name,args});if(options.rpc)return options.rpc(name,args);if(name==='claim_media_processing_v1')return claims++===0?[{...job,...options.job}]:[];if(name==='enqueue_media_processing_v1')return{state:'pending',job_id:jobid};if(name==='check_media_processing_v1')return !options.revoked;return true;},
 async download(j,signal){reads.push(j);if(options.download)return options.download(j,signal);return stream([video],{headers:{'Content-Length':String(video.length),...options.headers}});},
 async upload(j,bytes,signal){uploads.push({j,bytes:Buffer.from(bytes),signal});if(options.uploadError)throw new Error('network');}});
 const run=(body={action:'drain'},key=serviceKey)=>handler(new Request('https://fixture.test',{method:'POST',headers:{Authorization:'Bearer '+key},body:JSON.stringify(body)}));return{run,calls,uploads,reads};}
function admission(response,signal=new AbortController().signal,expected=video.length){return readAdmittedMedia(response,{expectedBytes:expected,maxBytes:16*1024*1024,signal});}
test('bounded media reads validate metadata and header lengths before consuming input',async()=>{
 for(const [expected,headers]of[[16*1024*1024+1,{}],[0,{}],[video.length,{'Content-Length':String(video.length+1)}],[video.length,{'Content-Encoding':'gzip'}]]){let cancelled=false;const r=stream([video],{headers,cancel:()=>cancelled=true,stall:true});await assert.rejects(admission(r,undefined,expected),/ADMISSION/);assert.equal(cancelled,true);}
 assert.deepEqual(Buffer.from(await admission(stream([video.subarray(0,8),video.subarray(8)]))),video);
});
test('missing Content-Length still enforces exact byte count; excess and truncated streams fail',async()=>{
 await assert.rejects(admission(stream([Buffer.alloc(video.length+1)])),/EXCESS/);await assert.rejects(admission(stream([Buffer.alloc(video.length-1)])),/TRUNCATED/);
});
test('an idle or adversarial response is cancelled by its read deadline',async()=>{
 const c=new AbortController();let cancelled=false;const work=admission(stream([],{stall:true,cancel:()=>cancelled=true}),c.signal);setTimeout(()=>c.abort(),15);await assert.rejects(work,/DEADLINE/);assert.equal(cancelled,true);
});
test('remux preserves original and media bytes with only the index relocated',()=>{
 const original=Buffer.from(video),out=faststartRemux(video);assert.equal(out.ok,true);assert.deepEqual(video,original);assert.equal(Buffer.from(out.buf).toString('ascii',ftyp.length+4,ftyp.length+8),'moov');assert.deepEqual(Buffer.from(out.buf).subarray(ftyp.length+index.length),mdat);assert.equal(faststartRemux(out.buf).reason,'already_faststart');
});
test('co64 offsets before old moov shift while a later mdat retains its absolute offset',()=>{
 const provisional=moov([ftyp.length+8,1],8),tail=box('mdat',Buffer.from('tail payload'));
 const secondOffset=ftyp.length+mdat.length+provisional.length+8;
 const oldIndex=moov([ftyp.length+8,secondOffset],8),input=Buffer.concat([ftyp,mdat,oldIndex,tail]),out=faststartRemux(input);assert.equal(out.ok,true);
 const buf=Buffer.from(out.buf),where=buf.indexOf(Buffer.from('co64'))+12;
 assert.equal(Number(buf.readBigUInt64BE(where)),ftyp.length+8+oldIndex.length);assert.equal(Number(buf.readBigUInt64BE(where+8)),secondOffset);assert.deepEqual(buf.subarray(secondOffset-8),tail);
});
test('truncated extended headers, forged counts, non-media offsets and fragmented files fail without writes',()=>{
 const truncated=Buffer.alloc(8);truncated.writeUInt32BE(1);truncated.write('moov',4);
 const forged=Buffer.from(video);forged.writeUInt32BE(0xffffffff,forged.indexOf(Buffer.from('stco'))+8);
 const invalid=Buffer.concat([ftyp,mdat,moov([0])]);
 for(const input of[truncated,forged,invalid,Buffer.concat([ftyp,mdat,box('moof'),index])])assert.equal(faststartRemux(input).ok,false);
 assert.equal(faststartRemux(video,video.length-1).reason,'too_large');
});
test('webhook admission authenticates and queues canonical identity without downloading',async()=>{
 const h=harness();const body={type:'INSERT',record:{id:object,version:'v1',bucket_id:'story-media',name:job.source_path}};
 assert.equal((await h.run(body,'untrusted')).status,401);assert.equal(h.calls.length,0);
 assert.equal((await h.run(body)).status,202);assert.equal(h.calls[0].name,'enqueue_media_processing_v1');assert.equal(h.reads.length,0);assert.equal(h.uploads.length,0);
 for(const change of[{bucket_id:'chat-media'},{name:job.output_path},{name:owner+'/../x.mp4'},{version:''}]){const before=h.calls.length;await h.run({...body,record:{...body.record,...change}});assert.equal(h.calls.length,before);}
});
test('worker writes a distinct immutable attempt path only after fresh source proof',async()=>{
 const h=harness();const response=await h.run();assert.equal(response.status,200);assert.equal(h.uploads.length,1);assert.equal(h.uploads[0].j.output_path,job.output_path);assert.notEqual(h.uploads[0].j.output_path,job.source_path);assert.deepEqual(h.uploads[0].bytes,Buffer.from(faststartRemux(video).buf));assert.equal(h.calls.find(x=>x.name==='finish_media_processing_v1').args.p_outcome,'ready');
});
test('source revocation and failed upload retain retry identity without original writes',async()=>{
 for(const options of[{revoked:true},{uploadError:true}]){const h=harness(options);assert.equal((await h.run()).status,503);const retry=h.calls.find(x=>x.name==='finish_media_processing_v1');assert.equal(retry.args.p_outcome,'retry');assert.equal(retry.args.p_job_id,jobid);assert.equal(retry.args.p_lease_id,lease);if(options.revoked)assert.equal(h.uploads.length,0);}
});
test('provider Retry-After stops draining and records a durable lane pause',async()=>{
 for(const retry of['120',new Date(Date.now()+120000).toUTCString()]){const h=harness({download:async()=>new Response(null,{status:429,headers:{'Retry-After':retry}})});assert.equal((await h.run()).status,200);const outcome=h.calls.find(x=>x.name==='finish_media_processing_v1').args;assert.equal(outcome.p_error_code,'upstream_throttled');assert.ok(outcome.p_retry_after_seconds>=118);assert.equal(h.reads.length,1);assert.equal(h.uploads.length,0);}
});
test('one isolate does not run simultaneous decoders and a job budget bounds claims',async()=>{
 let release;const held=new Promise(r=>release=r);const h=harness({download:async()=>{await held;return stream([video]);}});const first=h.run();while(!h.reads.length)await new Promise(r=>setTimeout(r,1));assert.equal((await(await h.run()).json()).state,'busy');release();assert.equal((await first).status,200);
 const bounded=harness({maxJobs:1});await bounded.run();assert.equal(bounded.calls.filter(x=>x.name==='claim_media_processing_v1').length,1);
});
test('worker deadline records retry without waiting for an uncooperative network promise',async()=>{
 const h=harness({deadlineMs:15,download:()=>new Promise(()=>{})});const keepAlive=setTimeout(()=>{},100);try{assert.equal((await h.run()).status,503);assert.equal(h.calls.at(-1).args.p_error_code,'worker_deadline');assert.equal(h.uploads.length,0);}finally{clearTimeout(keepAlive);}
});
test('oversized/mismatched job proofs cannot start a download and unsupported media moves to durable external work',async()=>{
 for(const change of[{source_bytes:16*1024*1024+1},{output_path:job.source_path},{source_bucket:'chat-media'}]){const h=harness({job:change});assert.equal((await h.run()).status,503);assert.equal(h.reads.length,0);}
 const bad=Buffer.from(video);bad.writeUInt32BE(0xffffffff,bad.indexOf(Buffer.from('stco'))+8);const h=harness({download:async()=>stream([bad])});assert.equal((await h.run()).status,200);assert.equal(h.calls.find(x=>x.name==='finish_media_processing_v1').args.p_outcome,'external');assert.equal(h.uploads.length,0);
});

test('zero-size tail indexes become explicit lengths after relocation',()=>{
 const zero=Buffer.from(video);zero.writeUInt32BE(0,ftyp.length+mdat.length);const result=faststartRemux(zero);assert.equal(result.ok,true);assert.equal(Buffer.from(result.buf).readUInt32BE(ftyp.length),index.length);assert.deepEqual(Buffer.from(result.buf).subarray(ftyp.length+index.length),mdat);
});
test('maintenance is bounded and may remove only a sealed private derivative path',async()=>{
 const deleted=[],calls=[],entry={lease_id:lease,cleanup_lease:id(8),object_id:id(9),bucket:'derived-media',path:job.output_path,version:'v-out'};
 let invalid=false;
 const handler=createDurableFaststartHandler({serviceKey,rpc:async(name,args)=>{calls.push({name,args});return name==='claim_media_cleanup_v1'?[{...entry,...(invalid?{path:job.source_path}:{})}]:name==='reconcile_media_processing_v1'?1:true;},download:()=>{throw Error('unexpected download');},upload:()=>{throw Error('unexpected upload');},remove:async(bucket,path)=>deleted.push({bucket,path})});
 const run=()=>handler(new Request('https://fixture.test',{method:'POST',headers:{apikey:serviceKey},body:JSON.stringify({action:'maintenance'})}));
 assert.equal((await run()).status,200);assert.equal(deleted[0].bucket,'derived-media');assert.equal(deleted[0].path,job.output_path);assert.equal(calls.find(x=>x.name==='claim_media_cleanup_v1').args.p_limit,10);
 invalid=true;assert.equal((await run()).status,503);assert.equal(deleted.length,1);
});
test('a generated H.264/AAC MP4 decodes to identical frames and audio after remux',t=>{
 const {execFileSync}=require('node:child_process'),os=require('node:os');
 try{execFileSync('ffmpeg',['-version'],{stdio:'ignore'});}catch{t.skip('FFmpeg is unavailable; run the local media integration gate before release.');return;}
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pc-faststart-fixture-'));
 try{
  const source=path.join(dir,'source.mp4'),derived=path.join(dir,'derived.mp4');
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=64x64:rate=12','-f','lavfi','-i','sine=frequency=1000:sample_rate=48000','-t','1','-c:v','libx264','-preset','ultrafast','-c:a','aac','-y',source]);
  const original=fs.readFileSync(source),result=faststartRemux(original);assert.equal(result.ok,true);fs.writeFileSync(derived,result.buf);
  const decoded=file=>execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-i',file,'-map','0','-f','framemd5','-'],{encoding:'utf8'});
  assert.equal(decoded(derived),decoded(source));assert.equal(fs.readFileSync(source).equals(original),true);
 } finally{fs.rmSync(dir,{recursive:true,force:true});}
});
