const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {test}=require('node:test');
const modulePromise=import('../../tools/reuse-live-connected-evidence.mjs');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function repository(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'connected-reuse-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const git=args=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();git(['init','-q']);git(['config','user.email','fixture@example.invalid']);git(['config','user.name','Fixture']);const write=(file,value)=>{fs.mkdirSync(path.dirname(path.join(dir,file)),{recursive:true});fs.writeFileSync(path.join(dir,file),value);};write('runtime.txt','unchanged');git(['add','.']);git(['commit','-qm','base']);return{git,write,base:git(['rev-parse','HEAD']),commit(){git(['add','.']);git(['commit','-qm','fixture']);return git(['rev-parse','HEAD']);}};}

test('real Git trees permit only the immediate fixture correction and preserve every other path',async t=>{const m=await modulePromise,r=repository(t);for(const file of m.ALLOWED)r.write(file,'fixture');const head=r.commit();assert.equal(m.sourceEquivalent(r.git,head,r.base),true);r.write('runtime.txt','changed');const runtime=r.commit();assert.throws(()=>m.sourceEquivalent(args=>args[0]==='show'?r.base:r.git(args),runtime,r.base));assert.equal(m.sourceEquivalent(r.git,runtime,r.base),false,'later releases use normal provider acceptance');});
test('uncommitted and staged runtime edits cannot reuse a committed fixture-only tree',async t=>{const m=await modulePromise,r=repository(t);for(const file of m.ALLOWED)r.write(file,'fixture');const head=r.commit();r.write('runtime.txt','uncommitted');assert.throws(()=>m.sourceEquivalent(r.git,head,r.base));r.git(['add','runtime.txt']);assert.throws(()=>m.sourceEquivalent(r.git,head,r.base));});
test('missing allowed changes, merge parents and checkout mismatch reject reuse',async t=>{const m=await modulePromise,r=repository(t);r.write(m.ALLOWED[0],'only one');const head=r.commit();assert.throws(()=>m.sourceEquivalent(r.git,head,r.base));assert.throws(()=>m.sourceEquivalent(args=>args[0]==='show'?`${r.base} ${'b'.repeat(40)}`:r.git(args),head,r.base));assert.throws(()=>m.sourceEquivalent(r.git,'f'.repeat(40),r.base));});

function nativeRepository(t, m) {
  const r=repository(t);
  for(const file of m.NATIVE_CORRECTION.files) if(!m.ALLOWED.includes(file.path)) r.write(file.path,'original native bytes\n');
  r.write('web/runtime.ts','original connected runtime\n');
  const accepted=r.commit();
  for(const file of m.ALLOWED) r.write(file,'reviewed fixture correction\n');
  const parent=r.commit(),parentTree=r.git(['rev-parse',parent+'^{tree}']);
  const files=m.NATIVE_CORRECTION.files.map(file=>{
    const bytes='reviewed correction '+file.path+'\n';r.write(file.path,bytes);
    return {...file,sha256:sha(Buffer.from(bytes))};
  });
  for(const file of m.VERIFIER_FILES) r.write(file,'reviewed verifier\n');
  const head=r.commit();
  const dir=r.git(['rev-parse','--show-toplevel']);
  const git=args=>args[0]==='show'&&args.at(-1).includes(':')
    ?execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','ignore']}):r.git(args);
  return {...r,git,accepted,parent,head,rule:{parent,parentTree,files},
    amend(){r.git(['add','.']);r.git(['commit','--amend','--no-edit','-q']);return r.git(['rev-parse','HEAD']);},
    fullPath(file){return path.join(r.git(['rev-parse','--show-toplevel']),file);},
  };
}
test('the exact native child preserves connected source while requiring fresh native acceptance',async t=>{
  const m=await modulePromise,r=nativeRepository(t,m);
  const scope=m.sourceApplicability(r.git,r.head,r.accepted,r.rule);
  assert.equal(scope.kind,'native-clips-correction');assert.equal(scope.comparisonParent,r.parent);
  assert.equal(scope.comparisonParentTree,r.rule.parentTree);
  assert.equal(scope.connectedRuntimeEquivalent,true);assert.equal(scope.nativeRuntimeEquivalent,false);
  assert.equal(Object.hasOwn(scope,'runtimeEquivalent'),false,'Do not claim whole-app equivalence');
  assert.deepEqual(scope.verifiedFiles,r.rule.files);
  assert.deepEqual(scope.permittedChanges,[...r.rule.files.map(file=>file.path),...m.VERIFIER_FILES].sort());
  assert.equal(m.sourceEquivalent(r.git,r.head,r.accepted,r.rule),true);
});
test('every frozen native, fixture, flow, acknowledgement and workflow hash is enforced',async t=>{
  const m=await modulePromise;
  for(const file of m.NATIVE_CORRECTION.files){
    const r=nativeRepository(t,m);r.write(file.path,'unreviewed replacement\n');const changed=r.amend();
    assert.throws(()=>m.sourceEquivalent(r.git,changed,r.accepted,r.rule),/Reviewed correction bytes changed/);
  }
});
test('executable or symlink mode changes cannot enter either reviewed native or verifier files',async t=>{
  const m=await modulePromise;
  for(const file of [m.NATIVE_CORRECTION.files[0].path,m.VERIFIER_FILES[0]]){
    const r=nativeRepository(t,m);fs.chmodSync(r.fullPath(file),0o755);const changed=r.amend();
    assert.throws(()=>m.sourceEquivalent(r.git,changed,r.accepted,r.rule),/Reviewed file mode changed/);
  }
  const r=nativeRepository(t,m),file=m.NATIVE_CORRECTION.files[0].path;
  fs.unlinkSync(r.fullPath(file));fs.symlinkSync('runtime.txt',r.fullPath(file));const changed=r.amend();
  assert.throws(()=>m.sourceEquivalent(r.git,changed,r.accepted,r.rule),/change file type/);
});
test('missing, additional, deleted or renamed native-child changes fail closed',async t=>{
  const m=await modulePromise;
  for(const kind of ['missing','additional','deleted','renamed']){
    const r=nativeRepository(t,m),file=m.NATIVE_CORRECTION.files[0].path;
    if(kind==='missing')r.write(file,r.git(['show',r.parent+':'+file]));
    if(kind==='additional')r.write('src/unreviewed.ts','extra native change');
    if(kind==='deleted')fs.unlinkSync(r.fullPath(file));
    if(kind==='renamed')fs.renameSync(r.fullPath(file),r.fullPath(file)+'.moved');
    const changed=r.amend();
    assert.throws(()=>m.sourceEquivalent(r.git,changed,r.accepted,r.rule),/unreviewed or missing change|cannot add, delete, rename/);
  }
});
test('connected runtime drift is rejected even if incorrectly added to a proposed frozen list',async t=>{
  const m=await modulePromise,r=nativeRepository(t,m),file='web/runtime.ts',bytes='changed connected runtime\n';
  r.write(file,bytes);const changed=r.amend();
  assert.throws(()=>m.sourceEquivalent(r.git,changed,r.accepted,r.rule),/unreviewed or missing change/);
  const broadened={...r.rule,files:[...r.rule.files,{path:file,mode:'100644',sha256:sha(Buffer.from(bytes))}]};
  assert.throws(()=>m.sourceEquivalent(r.git,changed,r.accepted,broadened),/Connected runtime or preparation changed/);
});
test('native reuse rejects the wrong parent tree, ancestry, merge order and checkout',async t=>{
  const m=await modulePromise,r=nativeRepository(t,m);
  assert.throws(()=>m.sourceEquivalent(r.git,r.head,r.accepted,{...r.rule,parentTree:'f'.repeat(40)}),/parent tree changed/);
  assert.throws(()=>m.sourceEquivalent(args=>args[0]==='show'&&args.at(-1)===r.parent?'e'.repeat(40):r.git(args),r.head,r.accepted,r.rule),/parent ancestry changed/);
  for(const parents of [[r.parent,'e'.repeat(40)],['e'.repeat(40),r.parent]]){
    assert.throws(()=>m.sourceEquivalent(args=>args[0]==='show'&&args.at(-1)==='HEAD'?parents.join(' '):r.git(args),r.head,r.accepted,r.rule),/single-parent correction/);
  }
  assert.throws(()=>m.sourceEquivalent(r.git,'f'.repeat(40),r.accepted,r.rule),/Checkout differs/);
});
test('uncommitted and staged native-child changes reject reuse before any evidence access',async t=>{
  const m=await modulePromise,r=nativeRepository(t,m),file=m.NATIVE_CORRECTION.files[0].path;
  r.write(file,'dirty native code');
  assert.throws(()=>m.sourceEquivalent(r.git,r.head,r.accepted,r.rule),/Tracked checkout or index differs/);
  r.git(['add',file]);
  assert.throws(()=>m.sourceEquivalent(r.git,r.head,r.accepted,r.rule),/Tracked checkout or index differs/);
});
test('a native-child mismatch rejects the reuse operation without fetching or emitting a provider fallback',async t=>{
  const m=await modulePromise,r=nativeRepository(t,m);let fetches=0;
  const git=args=>{
    if(args[0]==='show'&&args.at(-1)==='HEAD')return m.NATIVE_CORRECTION.parent;
    if(args[0]==='show'&&args.at(-1)===m.NATIVE_CORRECTION.parent)return m.PINNED.source;
    if(args[0]==='rev-parse'&&args[1]===m.NATIVE_CORRECTION.parent+'^{tree}')return m.NATIVE_CORRECTION.parentTree;
    return r.git(args.map(arg=>arg===m.PINNED.source?r.accepted:arg===m.NATIVE_CORRECTION.parent?r.parent:arg));
  };
  const evidence=r.fullPath('evidence-not-created');
  await assert.rejects(m.reuseConnected({git,fetcher:async()=>{fetches++;throw Error('No fetch expected');},
    env:{GITHUB_REPOSITORY:m.PINNED.repository,GITHUB_SHA:r.head,GITHUB_TOKEN:'synthetic',LIVE_CONNECTED_EVIDENCE:evidence},
  }),/Reviewed correction bytes changed/);
  assert.equal(fetches,0);assert.equal(fs.existsSync(evidence),false);
});
function metadata(){const pinned={repository:'donadmiral/tbirds-nest',source:'a'.repeat(40),runId:10,jobId:20,artifactId:30,archiveSha256:'b'.repeat(64)};return{pinned,run:{id:10,head_sha:pinned.source,path:'.github/workflows/live-release-acceptance.yml',event:'push',head_repository:{full_name:pinned.repository}},job:{id:20,run_id:10,name:'connected-host-viewer',status:'completed',conclusion:'success'},artifact:{id:30,name:'live-connected-acceptance',expired:false,workflow_run:{id:10,head_sha:pinned.source},digest:'sha256:'+pinned.archiveSha256,size_in_bytes:100}};}
test('successful job and artifact identities are all bound to the approved source',async()=>{const m=await modulePromise,v=metadata();m.verifyMetadata(v.run,v.job,v.artifact,v.pinned);for(const mutate of [v=>v.run.head_sha='c'.repeat(40),v=>v.run.event='pull_request',v=>v.run.head_repository.full_name='other/repo',v=>v.job.id++,v=>v.job.conclusion='failure',v=>v.job.status='in_progress',v=>v.artifact.expired=true,v=>v.artifact.workflow_run.id++,v=>v.artifact.workflow_run.head_sha='c'.repeat(40),v=>v.artifact.digest='sha256:'+'c'.repeat(64),v=>v.artifact.size_in_bytes=65*1024*1024]){const changed=metadata();mutate(changed);assert.throws(()=>m.verifyMetadata(changed.run,changed.job,changed.artifact,changed.pinned));}});
function receipt(){return{source:'a'.repeat(40),failure:null,errors:[],cleanup:{ok:true,cleaned_users:3},checks:[
'Guest request, cancellation, renewed request and host approval reached separate browsers without refreshing or starting a camera',
'Joining the approved guest automatically published the host and guest interview scene without manual camera selection',
'Real encoder completed the recorded clip and approved private output assets',
'Feed post references authorized clip media and delivers real MP4 bytes to the follower',...Array.from({length:33},(_,i)=>'other '+i)],players:[1,2].map(stream=>({observation:'decoded-portrait-hls',stream,width:1080,height:1920,readyState:4,currentTime:3})),controls:[{automatic:true,status:200,ok:true}],clipId:'11111111-1111-4111-8111-111111111111',postId:'22222222-2222-4222-8222-222222222222'};}
test('receipt requires real portrait, guest publication, clip output and successful cleanup',async()=>{const m=await modulePromise;m.verifyReceipt(receipt(),metadata().pinned);for(const mutate of [r=>r.source='c'.repeat(40),r=>r.failure='failed',r=>r.errors.push('failure'),r=>r.cleanup.cleaned_users=2,r=>r.checks.shift(),r=>r.players[0].height=720,r=>r.players.pop(),r=>r.controls[0].ok=false,r=>r.clipId=null]){const r=receipt();mutate(r);assert.throws(()=>m.verifyReceipt(r,metadata().pinned));}});
function archive(names){return execFileSync('python3',['-c','import io,json,sys,zipfile\nb=io.BytesIO()\nwith zipfile.ZipFile(b,"w") as z:\n for name,value in json.loads(sys.stdin.read()):z.writestr(name,value)\nsys.stdout.buffer.write(b.getvalue())'],{input:JSON.stringify(names),maxBuffer:5*1024*1024,stdio:['pipe','pipe','ignore']});}
test('the downloaded ZIP digest, unique receipt and decompressed receipt size are enforced',async()=>{const m=await modulePromise,bytes=archive([['receipt.json',JSON.stringify(receipt())]]);assert.deepEqual(m.archiveReceipt(bytes,sha(bytes)),receipt());assert.throws(()=>m.archiveReceipt(bytes,'f'.repeat(64)));for(const names of [[['other.json','{}']],[['receipt.json','{}'],['receipt.json','{}']],[['receipt.json',' '.repeat(2*1024*1024+1)]]]){const bytes=archive(names);assert.throws(()=>m.archiveReceipt(bytes,sha(bytes)));}});
test('original receipt bytes and source identity survive reuse without reserialization',async()=>{
  const m=await modulePromise,original='  '+JSON.stringify(receipt(),null,3)+'\n\n';
  const bytes=archive([['receipt.json',original]]),read=m.archiveReceipt(bytes,sha(bytes),true);
  assert.deepEqual(read.receipt,receipt());assert.equal(read.receipt.source,metadata().pinned.source);
  assert.equal(read.receiptBytes.equals(Buffer.from(original)),true);
  assert.equal(read.receiptSha256,sha(Buffer.from(original)));
});
test('artifact storage never receives the GitHub token and downloads stay bounded',async()=>{const m=await modulePromise,calls=[];const fetcher=async(url,options)=>{calls.push({url,options});return calls.length===1?new Response(null,{status:302,headers:{location:'https://storage.example.invalid/artifact?signature=fixture'}}):new Response('zip');};const bytes=await m.fetchArchive(fetcher,'https://api.github.com/repos/donadmiral/tbirds-nest',{Authorization:'Bearer synthetic'},30);assert.equal(bytes.toString(),'zip');assert.equal(calls[0].options.headers.Authorization,'Bearer synthetic');assert.equal(calls[1].options.headers,undefined);assert.equal(calls[1].options.redirect,'error');await assert.rejects(m.boundedBody(new Response('12345'),4));await assert.rejects(m.fetchArchive(async()=>new Response(null,{status:302,headers:{location:'http://unsafe.invalid/a'}}),'https://api.github.com',{},30));});
test('workflow retains every gate and reads three commits before authorizing any provider activity',async()=>{const m=await modulePromise,workflow=fs.readFileSync(path.join(__dirname,'../../.github/workflows/live-release-acceptance.yml'),'utf8');const block=workflow.slice(workflow.indexOf('  connected-host-viewer:'),workflow.indexOf('  release-checks:'));assert.match(block,/actions: read/);assert.match(block,/fetch-depth: 3/);assert.equal((block.match(/if: steps.connected_evidence.outputs.reused != 'true'/g)||[]).length,3);assert.ok(block.indexOf('node tools/reuse-live-connected-evidence.mjs')<block.indexOf('npm ci --prefix web'));assert.doesNotMatch(block,/continue-on-error/);assert.match(workflow,/needs: \[release-checks, browser-baseline, connected-host-viewer, web-production-build\]/);assert.equal(sha(Buffer.from(workflow)),m.NATIVE_CORRECTION.files.find(file=>file.path==='.github/workflows/live-release-acceptance.yml').sha256,'The sole workflow change is the reviewed fetch depth, with all fresh gates preserved');});
